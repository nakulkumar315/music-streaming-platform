import { Router } from "express";
import { pool } from "../../common/db";
import { createPlaybackToken } from "../../shared/security/signed-media-token.service";
import { getMediaConfig } from "../../config/media.config";
import { invalidateContentCache } from "../../common/cache";
import { AuditService } from "../../shared/audit/audit.service";
import { requireRoles } from "../../common/auth/requireRoles";

const router = Router();
const requireAdmin = requireRoles("ADMIN");
const requireContentModerator = requireRoles("ADMIN", "MODERATOR");

router.get("/pending", requireContentModerator, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  return res.status(404).json({
    success: false,
    message: "Content approval workflow has been removed",
    correlationId
  });
});

router.get("/flagged", requireContentModerator, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";

  try {
    const mediaCfg = getMediaConfig();
    const baseUrlFull = `${req.protocol}://${req.get("host")}`;

    const toAbsoluteUrl = (value: any) => {
      const raw = (value ?? "").toString().trim();
      if (!raw) return null;
      if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
      if (raw.startsWith("/")) return `${baseUrlFull}${raw}`;
      return `${baseUrlFull}/${raw}`;
    };

    const streamRoute = (mediaCfg.localPrivateStreamRoute || "media/stream").replace(/^\//, "");

    const issueStreamUrl = (contentId: number, userId: number, kind: "audio" | "video") => {
      const token = createPlaybackToken(contentId, userId, mediaCfg.mediaUrlTtlSeconds);
      return `${baseUrlFull}/${streamRoute}/${contentId}?token=${encodeURIComponent(token)}&kind=${encodeURIComponent(kind)}`;
    };

    const limit = Number(req.query.limit) || 10;
    const offset = Number(req.query.offset) || 0;

    const rows = await pool.query(
      `WITH reason_counts AS (
         SELECT content_id, reason, COUNT(*)::int as count
         FROM reports
         GROUP BY 1, 2
       )
       SELECT
         c.id,
         c.title,
         c.type,
         c.thumbnail_url,
         c.thumbnail_storage_key,
         c.media_url,
         c.audio_url,
         c.video_url,
         c.storage_key,
         c.video_storage_key,
         c.lifecycle_state,
         c.is_approved,
         c.status,
         c.report_count,
         c.created_at,
         c.artist_id,
         COALESCE(NULLIF(u.name, ''), NULLIF(split_part(u.email, '@', 1), ''), u.email) as artist_name,
         COALESCE(
           json_agg(json_build_object('reason', rc.reason, 'count', rc.count))
             FILTER (WHERE rc.reason IS NOT NULL),
           '[]'::json
         ) as reasons
       FROM content_items c
       LEFT JOIN users u ON u.id = c.artist_id
       LEFT JOIN reason_counts rc ON rc.content_id = c.id
       WHERE (UPPER(COALESCE(c.status, '')) = 'FLAGGED' OR c.report_count > 0)
         AND UPPER(COALESCE(c.status, '')) != 'DELETED'
       GROUP BY c.id, u.id
       ORDER BY c.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const items = (rows.rows ?? []).map((r: any) => {
      const typeRaw = (r.type ?? "").toString().toUpperCase();
      const hasAudio = Boolean(r.storage_key || r.audio_url || r.media_url);
      const hasVideo = Boolean(r.video_storage_key || r.video_url);

      const hasNewAudioStorage = Boolean(r.storage_key);
      const hasNewVideoStorage = Boolean(r.video_storage_key || (typeRaw.toLowerCase() === "video" && r.storage_key));

      const streamAudioUrl = hasNewAudioStorage ? issueStreamUrl(r.id, req.user?.id, "audio") : null;
      const streamVideoUrl = hasNewVideoStorage ? issueStreamUrl(r.id, req.user?.id, "video") : null;

      const finalAudioUrl = hasAudio ? (streamAudioUrl || toAbsoluteUrl(r.audio_url || r.media_url)) : null;
      const finalVideoUrl = hasVideo ? (streamVideoUrl || toAbsoluteUrl(r.video_url || r.media_url)) : null;

      let thumbnailUrl = null;
      if (r.thumbnail_url && (r.thumbnail_url.startsWith("http://") || r.thumbnail_url.startsWith("https://"))) {
        thumbnailUrl = r.thumbnail_url;
      } else if (r.id) {
        thumbnailUrl = `${baseUrlFull}/api/v1/fan/stream/thumbnail/${r.id}`;
      }

      return {
        id: r.id,
        title: r.title,
        type: typeRaw || (hasAudio && hasVideo ? "AUDIO_VIDEO" : hasVideo ? "VIDEO" : "AUDIO"),
        thumbnailUrl,
        mediaUrl: typeRaw.toLowerCase() === "video" ? finalVideoUrl : finalAudioUrl,
        audioUrl: finalAudioUrl,
        videoUrl: finalVideoUrl,
        status: (r.status ?? "FLAGGED").toString(),
        reportCount: Number(r.report_count ?? 0),
        reasons: r.reasons ?? [],
        artist: {
          id: r.artist_id,
          name: r.artist_name ?? null
        },
        createdAt: r.created_at,
        lifecycleState: r.lifecycle_state,
        isApproved: r.is_approved
      };
    });

    return res.json({ success: true, items, correlationId });
  } catch (err: any) {
    console.error("[admin/moderation] /flagged error", correlationId, err?.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch flagged content",
      correlationId
    });
  }
});

router.post("/:id/restore", requireContentModerator, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: "Invalid id", correlationId });
  }

  try {
    await pool.query("BEGIN");
    const updated = await pool.query(
      `UPDATE content_items
       SET status = 'APPROVED',
           report_count = 0,
           rejection_reason = NULL
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (!updated.rows?.length) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Content not found", correlationId });
    }

    await pool.query("DELETE FROM reports WHERE content_id = $1", [id]);
    await pool.query("COMMIT");

    await invalidateContentCache();

    AuditService.log({
      action: 'content.approved',
      entity: 'content',
      entityId: String(id),
      performedBy: req.user?.id,
      role: String(req.user?.role || "moderator").toLowerCase() as any,
      status: 'success',
      correlationId,
      metadata: { action: 'restore' }
    });

    return res.json({ success: true, correlationId });
  } catch (err: any) {
    await pool.query("ROLLBACK").catch(() => undefined);
    console.error("[admin/moderation] /restore error", correlationId, err?.message);
    return res.status(500).json({ success: false, message: "Failed to restore content", correlationId });
  }
});

router.post("/:id/delete-strike", requireContentModerator, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: "Invalid id", correlationId });
  }

  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS strike_count INT NOT NULL DEFAULT 0").catch(() => undefined);
    await pool.query("ALTER TABLE users ALTER COLUMN strike_count SET DEFAULT 0").catch(() => undefined);

    await pool.query("BEGIN");
    const updated = await pool.query(
      `UPDATE content_items
       SET status = 'DELETED'
       WHERE id = $1
       RETURNING id as content_id, artist_id`,
      [id]
    );

    const contentRow = updated.rows?.[0];

    if (!contentRow?.content_id) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Content not found", correlationId });
    }

    if (contentRow.artist_id) {
      await pool.query(
        `UPDATE users
         SET strike_count = COALESCE(strike_count, 0) + 1
         WHERE id = $1`,
        [contentRow.artist_id]
      );
    }

    await pool.query("DELETE FROM reports WHERE content_id = $1", [id]);
    await pool.query("COMMIT");

    await invalidateContentCache();

    AuditService.log({
      action: 'content.takedown',
      entity: 'content',
      entityId: String(id),
      performedBy: req.user?.id,
      role: String(req.user?.role || "moderator").toLowerCase() as any,
      status: 'success',
      correlationId,
      metadata: { reason: 'strike applied' }
    });

    return res.json({ success: true, correlationId });
  } catch (err: any) {
    await pool.query("ROLLBACK").catch(() => undefined);
    console.error("[admin/moderation] /delete-strike error", correlationId, err?.message);
    return res.status(500).json({ success: false, message: "Failed to delete content", correlationId });
  }
});

router.post("/artists/:artistId/ban", requireAdmin, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const artistId = Number(req.params.artistId);
  if (!Number.isFinite(artistId)) {
    return res.status(400).json({ success: false, message: "Invalid artistId", correlationId });
  }

  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'").catch(() => undefined);
    const r = await pool.query(
      "UPDATE users SET status = 'BANNED' WHERE id = $1 RETURNING id",
      [artistId]
    );

    if (!r.rows?.length) {
      return res.status(404).json({ success: false, message: "Artist not found", correlationId });
    }

    AuditService.log({
      action: 'admin.user_banned',
      entity: 'user',
      entityId: String(artistId),
      performedBy: req.user?.id,
      role: 'admin',
      status: 'success',
      correlationId,
      metadata: { action: 'ban' }
    });

    return res.json({ success: true, correlationId });
  } catch (err: any) {
    console.error("[admin/moderation] /ban error", correlationId, err?.message);
    return res.status(500).json({ success: false, message: "Failed to ban artist", correlationId });
  }
});

router.patch("/:id/approve", requireContentModerator, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  return res.status(404).json({
    success: false,
    message: "Content approval workflow has been removed",
    correlationId
  });
});

router.patch("/:id/reject", requireContentModerator, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  return res.status(404).json({
    success: false,
    message: "Content approval workflow has been removed",
    correlationId
  });
});

export default router;
