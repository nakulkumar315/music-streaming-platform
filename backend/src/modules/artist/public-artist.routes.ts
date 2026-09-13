import { Router } from "express";
import { pool } from "../../common/db";
import { optionalAuth } from "../../common/auth/requireAuth";

const router = Router();

function pageNumber(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(parsed)));
}

function toAbsoluteUrl(req: any, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  return raw.startsWith("/") ? `${baseUrl}${raw}` : `${baseUrl}/${raw}`;
}

function artworkUrl(req: any, contentId: number) {
  return `${req.protocol}://${req.get("host")}/api/v1/fan/stream/thumbnail/${contentId}`;
}

function artistVisibilityWhere(alias = "u") {
  return `UPPER(${alias}.role) = 'ARTIST'
    AND ${alias}.is_deleted = false
    AND UPPER(${alias}.status) = 'ACTIVE'
    AND ${alias}.is_verified = true
    AND UPPER(${alias}.artist_status::text) = 'APPROVED'`;
}

router.get("/featured", async (req, res) => {
  const limit = pageNumber(req.query.limit, 10, 50);
  const offset = pageNumber(req.query.offset, 0, 10_000);

  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.profile_image_url
         FROM featured_artists fa
         JOIN users u ON u.id = fa.artist_id
        WHERE fa.is_active = true
          AND ${artistVisibilityWhere("u")}
        ORDER BY fa.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.json({
      success: true,
      artists: result.rows.map((row: any) => ({
        id: Number(row.id),
        name: row.name ?? null,
        avatar: toAbsoluteUrl(req, row.profile_image_url),
      })),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch featured artists" });
  }
});

router.get("/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const limit = pageNumber(req.query.limit, 10, 50);
  const offset = pageNumber(req.query.offset, 0, 10_000);
  const cursor = req.query.cursor ? String(req.query.cursor).trim() : "";

  if (query.length < 2) {
    return res.json({ success: true, artists: [], nextCursor: null });
  }

  try {
    const pattern = `%${query}%`;
    const params: unknown[] = [pattern];
    let cursorClause = "";
    let paginationClause = "LIMIT $2 OFFSET $3";

    if (cursor) {
      params.push(cursor, limit);
      cursorClause = "AND LOWER(u.name) > LOWER($2)";
      paginationClause = "LIMIT $3";
    } else {
      params.push(limit, offset);
    }

    const result = await pool.query(
      `SELECT u.id, u.name, u.profile_image_url, u.subscription_price
         FROM users u
        WHERE ${artistVisibilityWhere("u")}
          AND LOWER(u.name) LIKE LOWER($1)
          ${cursorClause}
        ORDER BY u.name ASC
        ${paginationClause}`,
      params
    );

    const artists = result.rows.map((row: any) => ({
      id: Number(row.id),
      name: row.name ?? null,
      isVerified: true,
      profileImageUrl: toAbsoluteUrl(req, row.profile_image_url),
      status: "ACTIVE",
      subscriptionPrice: Number(row.subscription_price ?? 0),
    }));

    return res.json({
      success: true,
      artists,
      nextCursor: artists.length ? artists[artists.length - 1].name : null,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Search failed" });
  }
});

router.get("/", async (req, res) => {
  const limit = pageNumber(req.query.limit, 10, 50);
  const offset = pageNumber(req.query.offset, 0, 10_000);

  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.profile_image_url, u.subscription_price
         FROM users u
        WHERE ${artistVisibilityWhere("u")}
        ORDER BY u.id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.json({
      success: true,
      artists: result.rows.map((row: any) => ({
        id: Number(row.id),
        name: row.name ?? null,
        isVerified: true,
        profileImageUrl: toAbsoluteUrl(req, row.profile_image_url),
        status: "ACTIVE",
        subscriptionPrice: Number(row.subscription_price ?? 0),
      })),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch artists" });
  }
});

router.get("/:artistId/content", optionalAuth, async (req: any, res) => {
  const artistId = Number(req.params.artistId);
  if (!Number.isSafeInteger(artistId) || artistId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid artistId" });
  }

  const limit = pageNumber(req.query.limit, 10, 50);
  const offset = pageNumber(req.query.offset, 0, 10_000);
  const cursorRaw = req.query.cursor ? String(req.query.cursor) : "";
  const cursor = cursorRaw ? new Date(cursorRaw) : null;
  const useCursor = Boolean(cursor && !Number.isNaN(cursor.getTime()));
  const authenticatedFanId =
    String(req.user?.role || "").toUpperCase() === "FAN" ? Number(req.user?.id) : null;
  const fanId = Number.isSafeInteger(authenticatedFanId) && Number(authenticatedFanId) > 0
    ? Number(authenticatedFanId)
    : null;

  try {
    const artist = await pool.query(
      `SELECT u.id
         FROM users u
        WHERE u.id = $1 AND ${artistVisibilityWhere("u")}
        LIMIT 1`,
      [artistId]
    );
    if (!artist.rows.length) {
      return res.status(404).json({ success: false, message: "Artist not found" });
    }

    const params: unknown[] = [fanId, artistId];
    let cursorClause = "";
    let pageClause = "LIMIT $3 OFFSET $4";
    if (useCursor) {
      params.push(cursor!.toISOString(), limit);
      cursorClause = "AND c.created_at < $3";
      pageClause = "LIMIT $4";
    } else {
      params.push(limit, offset);
    }

    const result = await pool.query(
      `SELECT c.id, c.title, c.type, c.genre, c.created_at,
              c.subscription_required,
              (SELECT COUNT(*)::int FROM content_plays p WHERE p.content_id = c.id) AS view_count,
              (SELECT COUNT(*)::int FROM content_reactions r WHERE r.content_id = c.id AND r.reaction = 'like') AS like_count,
              (SELECT COUNT(*)::int FROM content_reactions r WHERE r.content_id = c.id AND r.reaction = 'dislike') AS dislike_count,
              CASE
                WHEN $1::int IS NULL THEN false
                ELSE EXISTS (
                  SELECT 1
                    FROM subscriptions s
                   WHERE s.user_id = $1
                     AND s.type = 'ARTIST'
                     AND s.artist_id = c.artist_id
                     AND s.status = 'ACTIVE'
                     AND s.next_billing_date IS NOT NULL
                     AND s.next_billing_date > now()
                )
              END AS has_subscription
         FROM content_items c
        WHERE c.artist_id = $2
          AND c.lifecycle_state = 'EARLY_ACCESS'
          AND c.is_approved = TRUE
          AND c.is_taken_down = FALSE
          AND c.status = 'READY'
          ${cursorClause}
        ORDER BY c.created_at DESC
        ${pageClause}`,
      params
    );

    const content = result.rows.map((row: any) => {
      const subscriptionRequired = row.subscription_required === true;
      const isLocked = subscriptionRequired && row.has_subscription !== true;
      const type = String(row.type || "AUDIO").toUpperCase();
      const art = artworkUrl(req, Number(row.id));
      return {
        id: Number(row.id),
        title: row.title ?? "Untitled",
        type,
        genre: row.genre ?? null,
        mediaType: type === "VIDEO" ? "video" : "audio",
        artwork: art,
        thumbnailUrl: art,
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
        viewCount: Number(row.view_count ?? 0),
        likeCount: Number(row.like_count ?? 0),
        dislikeCount: Number(row.dislike_count ?? 0),
      };
    });

    return res.json({
      success: true,
      content,
      nextCursor: content.length
        ? new Date(content[content.length - 1].createdAt).toISOString()
        : null,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch artist content" });
  }
});

router.get("/:artistId", async (req, res) => {
  const artistId = Number(req.params.artistId);
  if (!Number.isSafeInteger(artistId) || artistId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid artistId" });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.profile_image_url, u.banner_image_url,
              u.bio, u.artist_bio, u.social_links, u.subscription_price,
              u.subscription_features
         FROM users u
        WHERE u.id = $1 AND ${artistVisibilityWhere("u")}
        LIMIT 1`,
      [artistId]
    );
    const row = result.rows?.[0];
    if (!row) {
      return res.status(404).json({ success: false, message: "Artist not found" });
    }

    const socialLinks = row.social_links ?? null;
    const bio = String(row.bio || row.artist_bio || "").trim();
    return res.json({
      success: true,
      artist: {
        id: Number(row.id),
        name: row.name ?? null,
        isVerified: true,
        profileImageUrl: toAbsoluteUrl(req, row.profile_image_url),
        coverImageUrl:
          toAbsoluteUrl(req, row.banner_image_url) || toAbsoluteUrl(req, row.profile_image_url),
        bio,
        socialLinks,
        spotifyUrl: socialLinks?.spotify ? String(socialLinks.spotify) : null,
        youtubeUrl: socialLinks?.youtube ? String(socialLinks.youtube) : null,
        instagramUrl: socialLinks?.instagram ? String(socialLinks.instagram) : null,
        status: "ACTIVE",
        subscriptionPrice: Number(row.subscription_price ?? 0),
        subscriptionFeatures: Array.isArray(row.subscription_features)
          ? row.subscription_features
          : [],
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch artist" });
  }
});

export default router;
