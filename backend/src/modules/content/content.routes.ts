import { Router } from "express";
import { pool } from "../../common/db";
import { optionalAuth } from "../../common/auth/requireAuth";
import { publicAppUrl } from "../../common/http/public-url";

const router = Router();

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseContentCursor(value: unknown): { createdAt: Date; id: number } | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const separator = raw.lastIndexOf("|");
  if (separator <= 0) return null;
  const createdAt = new Date(raw.slice(0, separator));
  const id = positiveInteger(raw.slice(separator + 1));
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

function thumbnailUrl(contentId: number) {
  return publicAppUrl(`/api/v1/fan/stream/thumbnail/${contentId}`);
}

function mapContent(row: any) {
  const type = String(row.type || "AUDIO").toUpperCase();
  const subscriptionRequired = Boolean(row.subscription_required);
  const hasSubscription = Boolean(row.has_subscription);
  const isLocked = subscriptionRequired && !hasSubscription;

  return {
    id: Number(row.id),
    title: String(row.title || "Untitled"),
    type,
    mediaType: type === "VIDEO" ? "video" : "audio",
    genre: row.genre ? String(row.genre) : null,
    artistId: Number(row.artist_id),
    artistName: row.artist_name ? String(row.artist_name) : null,
    thumbnailUrl: thumbnailUrl(Number(row.id)),
    artwork: thumbnailUrl(Number(row.id)),
    mediaUrl: null,
    fileUrl: null,
    audioUrl: null,
    videoUrl: null,
    useStreamAccess: !isLocked,
    playbackEndpoint: "/api/v1/fan/stream/access",
    subscriptionRequired,
    isLocked,
    lifecycleState: "EARLY_ACCESS",
    technicalStatus: "READY",
    createdAt: row.created_at,
    viewCount: Number(row.view_count || 0),
    likeCount: Number(row.like_count || 0),
    dislikeCount: Number(row.dislike_count || 0),
    userReaction: row.user_reaction ? String(row.user_reaction) : null,
  };
}

const GOVERNED_CONTENT_WHERE = `
  c.lifecycle_state = 'EARLY_ACCESS'
  AND c.is_approved = TRUE
  AND c.is_taken_down = FALSE
  AND c.status = 'READY'
  AND UPPER(u.role) = 'ARTIST'
  AND u.is_deleted = FALSE
  AND UPPER(u.status) = 'ACTIVE'
  AND u.is_verified = TRUE
  AND UPPER(u.artist_status::text) = 'APPROVED'
`;

function subscriptionExistsSql(userParam: string) {
  return `CASE
    WHEN ${userParam}::int IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
        FROM subscriptions s
       WHERE s.user_id = ${userParam}
         AND s.artist_id = c.artist_id
         AND s.type = 'ARTIST'
         AND s.status = 'ACTIVE'
         AND s.next_billing_date IS NOT NULL
         AND s.next_billing_date > now()
    )
  END`;
}

router.get("/", optionalAuth, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const userId = positiveInteger(req.user?.id);
  const limit = boundedInt(req.query?.limit, 50, 1, 100);
  const offset = boundedInt(req.query?.offset, 0, 0, 100_000);
  const cursorRaw = String(req.query?.cursor || "").trim();
  const cursor = parseContentCursor(cursorRaw);

  if (cursorRaw && !cursor) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CURSOR",
      message: "cursor is invalid",
      correlationId,
    });
  }

  try {
    const params: any[] = [userId];
    let cursorClause = "";
    let limitRef = "$2";
    let offsetClause = "OFFSET $3";

    if (cursor) {
      params.push(cursor.createdAt, cursor.id, limit);
      cursorClause = `AND (c.created_at < $2 OR (c.created_at = $2 AND c.id < $3))`;
      limitRef = "$4";
      offsetClause = "";
    } else {
      params.push(limit, offset);
    }

    const result = await pool.query(
      `SELECT c.id, c.title, c.type, c.genre, c.artist_id,
              c.subscription_required, c.created_at,
              COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) AS artist_name,
              (SELECT COUNT(*)::int FROM content_plays p WHERE p.content_id = c.id) AS view_count,
              (SELECT COUNT(*)::int FROM content_reactions r WHERE r.content_id = c.id AND r.reaction = 'like') AS like_count,
              (SELECT COUNT(*)::int FROM content_reactions r WHERE r.content_id = c.id AND r.reaction = 'dislike') AS dislike_count,
              (CASE WHEN $1::int IS NULL THEN NULL ELSE
                (SELECT r.reaction FROM content_reactions r WHERE r.content_id = c.id AND r.user_id = $1 LIMIT 1)
               END) AS user_reaction,
              ${subscriptionExistsSql("$1")} AS has_subscription
         FROM content_items c
         JOIN users u ON u.id = c.artist_id
        WHERE ${GOVERNED_CONTENT_WHERE}
          ${cursorClause}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${limitRef} ${offsetClause}`,
      params
    );

    const items = result.rows.map((row: any) => mapContent(row));
    const last = items[items.length - 1];
    return res.json({
      success: true,
      items,
      meta: {
        total: items.length,
        audio: items.filter((item: any) => item.mediaType === "audio").length,
        video: items.filter((item: any) => item.mediaType === "video").length,
      },
      nextCursor:
        last?.createdAt && last?.id
          ? `${new Date(last.createdAt).toISOString()}|${last.id}`
          : null,
      correlationId,
    });
  } catch {
    return res.status(500).json({
      success: false,
      code: "CONTENT_CATALOG_FAILED",
      message: "Failed to fetch content catalog",
      correlationId,
    });
  }
});

router.get("/artist/:artistId", optionalAuth, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const artistId = positiveInteger(req.params.artistId);
  const userId = positiveInteger(req.user?.id);
  const limit = boundedInt(req.query?.limit, 50, 1, 100);
  const offset = boundedInt(req.query?.offset, 0, 0, 100_000);
  if (!artistId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ARTIST_ID",
      message: "Invalid artist id",
      correlationId,
    });
  }

  try {
    const result = await pool.query(
      `SELECT c.id, c.title, c.type, c.genre, c.artist_id,
              c.subscription_required, c.created_at,
              COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) AS artist_name,
              (SELECT COUNT(*)::int FROM content_plays p WHERE p.content_id = c.id) AS view_count,
              (SELECT COUNT(*)::int FROM content_reactions r WHERE r.content_id = c.id AND r.reaction = 'like') AS like_count,
              (SELECT COUNT(*)::int FROM content_reactions r WHERE r.content_id = c.id AND r.reaction = 'dislike') AS dislike_count,
              (CASE WHEN $2::int IS NULL THEN NULL ELSE
                (SELECT r.reaction FROM content_reactions r WHERE r.content_id = c.id AND r.user_id = $2 LIMIT 1)
               END) AS user_reaction,
              ${subscriptionExistsSql("$2")} AS has_subscription
         FROM content_items c
         JOIN users u ON u.id = c.artist_id
        WHERE c.artist_id = $1
          AND ${GOVERNED_CONTENT_WHERE}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $3 OFFSET $4`,
      [artistId, userId, limit, offset]
    );

    return res.json({
      success: true,
      items: result.rows.map((row: any) => mapContent(row)),
      page: { limit, offset, count: result.rows.length },
      correlationId,
    });
  } catch {
    return res.status(500).json({
      success: false,
      code: "ARTIST_CONTENT_FAILED",
      message: "Failed to fetch artist content",
      correlationId,
    });
  }
});

router.get("/:id", optionalAuth, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const contentId = positiveInteger(req.params.id);
  const userId = positiveInteger(req.user?.id);
  if (!contentId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CONTENT_ID",
      message: "Invalid content id",
      correlationId,
    });
  }

  try {
    const result = await pool.query(
      `SELECT c.id, c.title, c.type, c.genre, c.artist_id,
              c.subscription_required, c.created_at,
              COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) AS artist_name,
              (SELECT COUNT(*)::int FROM content_plays p WHERE p.content_id = c.id) AS view_count,
              (SELECT COUNT(*)::int FROM content_reactions r WHERE r.content_id = c.id AND r.reaction = 'like') AS like_count,
              (SELECT COUNT(*)::int FROM content_reactions r WHERE r.content_id = c.id AND r.reaction = 'dislike') AS dislike_count,
              (CASE WHEN $2::int IS NULL THEN NULL ELSE
                (SELECT r.reaction FROM content_reactions r WHERE r.content_id = c.id AND r.user_id = $2 LIMIT 1)
               END) AS user_reaction,
              ${subscriptionExistsSql("$2")} AS has_subscription
         FROM content_items c
         JOIN users u ON u.id = c.artist_id
        WHERE c.id = $1
          AND ${GOVERNED_CONTENT_WHERE}
        LIMIT 1`,
      [contentId, userId]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        code: "CONTENT_NOT_FOUND",
        message: "Content not found",
        correlationId,
      });
    }

    return res.json({
      success: true,
      content: mapContent(row),
      correlationId,
    });
  } catch {
    return res.status(500).json({
      success: false,
      code: "CONTENT_DETAIL_FAILED",
      message: "Failed to fetch content",
      correlationId,
    });
  }
});

export default router;
