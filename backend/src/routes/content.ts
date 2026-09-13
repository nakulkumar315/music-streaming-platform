import { Router } from "express";
import { pool } from "../common/db";
import { requireAuth, requireVerifiedArtist } from "../common/auth/requireAuth";
import { requireRoles } from "../common/auth/requireRoles";

const router = Router();
const requireFan = requireRoles("FAN");
const REPORT_REASON_MAX = 500;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function contentIsFanVisible(contentId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM content_items c
       JOIN users u ON u.id = c.artist_id
      WHERE c.id = $1
        AND c.lifecycle_state = 'EARLY_ACCESS'
        AND c.status = 'READY'
        AND c.is_approved = true
        AND c.is_taken_down = false
        AND u.is_deleted = false
        AND UPPER(u.status) = 'ACTIVE'
      LIMIT 1`,
    [contentId]
  );
  return result.rowCount === 1;
}

/**
 * Fans may report currently visible content. Report volume is a moderation
 * signal only; it must never overwrite the technical media status.
 */
router.post("/report", requireAuth, requireFan, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const userId = positiveInteger(req.user?.id);
  const contentId = positiveInteger(req.body?.contentId);
  const reason = String(req.body?.reason || "").trim();

  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized", correlationId });
  if (!contentId) {
    return res.status(400).json({ success: false, message: "contentId is required", correlationId });
  }
  if (!reason || reason.length > REPORT_REASON_MAX) {
    return res.status(400).json({
      success: false,
      message: `reason is required and must be at most ${REPORT_REASON_MAX} characters`,
      correlationId,
    });
  }

  try {
    if (!(await contentIsFanVisible(contentId))) {
      return res.status(404).json({ success: false, message: "Content not found", correlationId });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO reports (reason, content_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (content_id, user_id) DO NOTHING
         RETURNING id`,
        [reason, contentId, userId]
      );

      if (inserted.rowCount === 1) {
        await client.query(
          `UPDATE content_items
              SET report_count = report_count + 1
            WHERE id = $1`,
          [contentId]
        );
      }

      const current = await client.query(
        `SELECT report_count, is_taken_down
           FROM content_items
          WHERE id = $1
          LIMIT 1`,
        [contentId]
      );
      await client.query("COMMIT");

      return res.json({
        success: true,
        duplicate: inserted.rowCount !== 1,
        reportCount: Number(current.rows[0]?.report_count ?? 0),
        isTakenDown: current.rows[0]?.is_taken_down === true,
        correlationId,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch {
    return res.status(500).json({ success: false, message: "Failed to submit report", correlationId });
  }
});

router.post("/reaction", requireAuth, requireFan, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const userId = positiveInteger(req.user?.id);
  const contentId = positiveInteger(req.body?.contentId);
  const reaction = req.body?.reaction == null ? null : String(req.body.reaction).toLowerCase();

  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized", correlationId });
  if (!contentId) {
    return res.status(400).json({ success: false, message: "contentId is required", correlationId });
  }
  if (reaction !== null && reaction !== "like" && reaction !== "dislike") {
    return res.status(400).json({ success: false, message: "Invalid reaction", correlationId });
  }

  try {
    if (!(await contentIsFanVisible(contentId))) {
      return res.status(404).json({ success: false, message: "Content not found", correlationId });
    }

    if (reaction) {
      await pool.query(
        `INSERT INTO content_reactions (content_id, user_id, reaction)
         VALUES ($1, $2, $3)
         ON CONFLICT (content_id, user_id)
         DO UPDATE SET reaction = EXCLUDED.reaction`,
        [contentId, userId, reaction]
      );
    } else {
      await pool.query(
        `DELETE FROM content_reactions
          WHERE content_id = $1 AND user_id = $2`,
        [contentId, userId]
      );
    }

    return res.json({ success: true, correlationId });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to set reaction", correlationId });
  }
});

/**
 * Phase-1 artist content is read-only. The response intentionally exposes no
 * storage/provider identifiers and no playable media URLs.
 */
router.get(
  "/mine",
  requireAuth,
  requireVerifiedArtist,
  async (req: any, res: any) => {
    const correlationId = req?.correlationId || "-";
    const artistId = positiveInteger(req.user?.id);
    if (!artistId) {
      return res.status(401).json({ success: false, message: "Unauthorized", correlationId });
    }

    try {
      const result = await pool.query(
        `SELECT c.id,
                c.title,
                c.type,
                c.genre,
                c.lifecycle_state,
                c.status,
                c.is_approved,
                c.is_taken_down,
                c.rejection_reason,
                c.subscription_required,
                c.created_at,
                c.published_at,
                (c.thumbnail_storage_key IS NOT NULL) AS has_artwork,
                (c.storage_key IS NOT NULL) AS has_audio,
                (c.video_storage_key IS NOT NULL) AS has_video,
                COUNT(p.id)::int AS total_plays
           FROM content_items c
           LEFT JOIN content_plays p ON p.content_id = c.id
          WHERE c.artist_id = $1
          GROUP BY c.id
          ORDER BY c.created_at DESC
          LIMIT 500`,
        [artistId]
      );

      const items = result.rows.map((row: any) => ({
        id: Number(row.id),
        title: row.title,
        type: String(row.type || ""),
        genre: row.genre ?? null,
        lifecycleState: String(row.lifecycle_state),
        technicalStatus: String(row.status),
        isApproved: row.is_approved === true,
        isTakenDown: row.is_taken_down === true,
        rejectionReason: row.rejection_reason ?? null,
        subscriptionRequired: row.subscription_required === true,
        hasArtwork: row.has_artwork === true,
        hasAudio: row.has_audio === true,
        hasVideo: row.has_video === true,
        totalPlays: Number(row.total_plays ?? 0),
        createdAt: row.created_at,
        publishedAt: row.published_at ?? null,
      }));

      return res.json({ success: true, items, correlationId });
    } catch {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch artist content",
        correlationId,
      });
    }
  }
);

export default router;
