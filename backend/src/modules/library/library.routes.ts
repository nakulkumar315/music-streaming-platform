import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { pool } from "../../common/db";

const router = Router();

function boundedLimit(value: unknown, fallback = 10, max = 50) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function boundedOffset(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 10_000);
}

const toAbsoluteUrl = (req: any, value: any) => {
  const raw = (value ?? "").toString().trim();
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  if (raw.startsWith("/")) return `${baseUrl}${raw}`;
  return `${baseUrl}/${raw}`;
};

router.get("/subscribed-artists", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const limit = boundedLimit(req.query.limit);
  const offset = boundedOffset(req.query.offset);

  try {
    const rows = await pool.query(
      `SELECT
        u.id,
        COALESCE(u.name, u.email) as name,
        COALESCE(u.is_verified, u.verified, false) as is_verified,
        u.profile_image_url,
        COALESCE(u.status, 'ACTIVE') as status,
        COALESCE(u.genre, '') as genre
       FROM subscriptions s
       JOIN users u ON u.id = s.artist_id
       WHERE s.user_id = $1
         AND UPPER(COALESCE(s.status, 'ACTIVE')) = 'ACTIVE'
         AND (s.end_date IS NULL OR s.end_date > now())
         AND UPPER(COALESCE(u.role, '')) = 'ARTIST'
         AND COALESCE(u.status, 'ACTIVE') = 'ACTIVE'
       ORDER BY s.updated_at DESC, s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const artists = (rows.rows ?? []).map((r: any) => ({
      id: r.id,
      name: (r.name ?? "Artist").toString(),
      isVerified: Boolean(r.is_verified),
      profileImageUrl: toAbsoluteUrl(req, r.profile_image_url),
      status: (r.status ?? "ACTIVE").toString(),
      genre: (r.genre ?? "").toString(),
    }));

    return res.json({ success: true, artists });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch subscribed artists" });
  }
});

router.get("/recently-played", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const limit = boundedLimit(req.query.limit);
  const offset = boundedOffset(req.query.offset);

  try {
    const rows = await pool.query(
      `SELECT
        ph.content_id,
        ph.played_at,
        c.title,
        c.type,
        c.thumbnail_url,
        c.artist_id,
        COALESCE(a.name, a.email) as artist_name,
        a.profile_image_url as artist_profile_image_url
       FROM playback_history ph
       JOIN content_items c ON c.id = ph.content_id
       LEFT JOIN users a ON a.id = c.artist_id
       WHERE ph.user_id = $1
       ORDER BY ph.played_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const items = (rows.rows ?? []).map((r: any) => {
      const type = (r.type ?? "").toString().toLowerCase();
      const mediaType = type === "video" ? "video" : "audio";
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      return {
        id: r.content_id,
        title: (r.title ?? "Untitled").toString(),
        mediaType,
        artistId: r.artist_id ?? null,
        artistName: (r.artist_name ?? "Artist").toString(),
        artworkUrl: `${baseUrl}/api/v1/fan/stream/thumbnail/${r.content_id}`,
        // Protected playback URLs are never returned from library/history reads.
        // The client must obtain a fresh, entitlement-checked stream lease.
        mediaUrl: null,
        useStreamAccess: true,
        playedAt: r.played_at,
        artistProfileImageUrl: toAbsoluteUrl(req, r.artist_profile_image_url),
      };
    });

    return res.json({ success: true, items });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch recently played" });
  }
});

router.post("/playback", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const songId = Number(req.body?.songId ?? req.body?.contentId ?? req.body?.id);
  if (!Number.isSafeInteger(songId) || songId <= 0) {
    return res.status(400).json({ success: false, message: "songId is required" });
  }

  try {
    // This endpoint only updates the user's UX history. It is intentionally not
    // a trusted play/listening analytics source; trusted engagement is written
    // by the server heartbeat/session path.
    await pool.query(
      `INSERT INTO playback_history (user_id, content_id, played_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, content_id)
       DO UPDATE SET played_at = EXCLUDED.played_at`,
      [userId, songId]
    );

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to record playback" });
  }
});

export default router;
