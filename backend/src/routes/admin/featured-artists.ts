import { Router } from "express";
import { pool } from "../../common/db";
import { invalidateArtistCache, invalidateCachePattern } from "../../common/cache";
import { AuditService } from "../../shared/audit/audit.service";

const router = Router();

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function absoluteUrl(req: any, value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = `${req.protocol}://${req.get("host")}`;
  return raw.startsWith("/") ? `${base}${raw}` : `${base}/${raw}`;
}

async function invalidateFeatured() {
  await Promise.all([
    invalidateArtistCache(),
    invalidateCachePattern("featured_artists*"),
  ]);
}

function audit(req: any, action: string, entityId: string, metadata?: Record<string, unknown>) {
  AuditService.log({
    action,
    entity: "featured_artist",
    entityId,
    performedBy: Number(req.user?.id),
    role: "admin",
    status: "success",
    correlationId: req?.correlationId,
    metadata,
  });
}

router.get("/", async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  try {
    const result = await pool.query(
      `SELECT fa.id, fa.artist_id, fa.is_active, fa.created_at, fa.updated_at,
              u.name AS artist_name, u.email, u.profile_image_url,
              u.status, u.artist_status, u.is_verified, u.is_deleted
         FROM featured_artists fa
         JOIN users u ON u.id = fa.artist_id
        WHERE UPPER(u.role) = 'ARTIST'
        ORDER BY fa.created_at DESC`
    );

    return res.json({
      success: true,
      featured: result.rows.map((row: any) => ({
        id: Number(row.id),
        artistId: Number(row.artist_id),
        name: row.artist_name || String(row.email).split("@")[0],
        avatar: absoluteUrl(req, row.profile_image_url),
        isActive: Boolean(row.is_active),
        eligible:
          !Boolean(row.is_deleted) &&
          String(row.status || "").toUpperCase() === "ACTIVE" &&
          String(row.artist_status || "").toUpperCase() === "APPROVED" &&
          Boolean(row.is_verified),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      correlationId,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch featured artists", correlationId });
  }
});

router.post("/", async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const artistId = positiveInteger(req.body?.artistId);
  if (!artistId) {
    return res.status(400).json({ success: false, message: "artistId is required", correlationId });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const artistResult = await client.query(
      `SELECT id, name, email, profile_image_url
         FROM users
        WHERE id = $1
          AND UPPER(role) = 'ARTIST'
          AND UPPER(status) = 'ACTIVE'
          AND UPPER(artist_status) = 'APPROVED'
          AND is_verified = TRUE
          AND is_deleted = FALSE
        LIMIT 1
        FOR UPDATE`,
      [artistId]
    );
    const artist = artistResult.rows[0];
    if (!artist) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        code: "FEATURED_ARTIST_NOT_ELIGIBLE",
        message: "Only active, approved and verified artist accounts can be featured",
        correlationId,
      });
    }

    let result = await client.query(
      `UPDATE featured_artists
          SET is_active = TRUE, name = $2, avatar = $3, updated_at = now()
        WHERE artist_id = $1
        RETURNING id, artist_id, is_active, created_at, updated_at`,
      [artistId, artist.name, artist.profile_image_url]
    );
    if (!result.rowCount) {
      result = await client.query(
        `INSERT INTO featured_artists (artist_id, name, avatar, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, TRUE, now(), now())
         RETURNING id, artist_id, is_active, created_at, updated_at`,
        [artistId, artist.name, artist.profile_image_url]
      );
    }

    await client.query("COMMIT");
    const row = result.rows[0];
    await invalidateFeatured();
    audit(req, "featured_artist.enabled", String(row.id), { artist_id: artistId });

    return res.json({
      success: true,
      featured: {
        id: Number(row.id),
        artistId,
        name: artist.name || String(artist.email).split("@")[0],
        avatar: absoluteUrl(req, artist.profile_image_url),
        isActive: true,
        createdAt: row.created_at,
      },
      correlationId,
    });
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error?.code === "23505") {
      return res.status(409).json({ success: false, message: "Artist is already featured", correlationId });
    }
    return res.status(500).json({ success: false, message: "Failed to feature artist", correlationId });
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const featuredId = positiveInteger(req.params?.id);
  if (!featuredId || typeof req.body?.isActive !== "boolean") {
    return res.status(400).json({ success: false, message: "Valid id and isActive are required", correlationId });
  }

  try {
    if (req.body.isActive) {
      const eligibility = await pool.query(
        `SELECT 1
           FROM featured_artists fa
           JOIN users u ON u.id = fa.artist_id
          WHERE fa.id = $1
            AND UPPER(u.role) = 'ARTIST'
            AND UPPER(u.status) = 'ACTIVE'
            AND UPPER(u.artist_status) = 'APPROVED'
            AND u.is_verified = TRUE
            AND u.is_deleted = FALSE
          LIMIT 1`,
        [featuredId]
      );
      if (!eligibility.rowCount) {
        return res.status(409).json({
          success: false,
          code: "FEATURED_ARTIST_NOT_ELIGIBLE",
          message: "Artist is no longer eligible to be featured",
          correlationId,
        });
      }
    }

    const result = await pool.query(
      `UPDATE featured_artists
          SET is_active = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, artist_id, is_active, updated_at`,
      [featuredId, req.body.isActive]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ success: false, message: "Featured artist not found", correlationId });

    await invalidateFeatured();
    audit(req, req.body.isActive ? "featured_artist.enabled" : "featured_artist.disabled", String(featuredId), {
      artist_id: Number(row.artist_id),
    });
    return res.json({ success: true, featured: row, correlationId });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update featured artist", correlationId });
  }
});

router.delete("/:id", async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const featuredId = positiveInteger(req.params?.id);
  if (!featuredId) return res.status(400).json({ success: false, message: "Invalid featured artist id", correlationId });

  try {
    const result = await pool.query(
      `DELETE FROM featured_artists WHERE id = $1 RETURNING id, artist_id`,
      [featuredId]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ success: false, message: "Featured artist not found", correlationId });

    await invalidateFeatured();
    audit(req, "featured_artist.removed", String(featuredId), { artist_id: Number(row.artist_id) });
    return res.json({ success: true, correlationId });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to remove featured artist", correlationId });
  }
});

export default router;
