import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../../common/db";
import { invalidateArtistCache, invalidateCachePattern } from "../../common/cache";
import { logger } from "../../common/logger";
import { AuditService } from "../../shared/audit/audit.service";

const router = Router();

function correlationId(req: any) {
  return String(req?.correlationId || "-");
}

function actorId(req: any) {
  return Number(req.user?.id);
}

function positiveId(raw: unknown) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function fail(res: any, req: any, error: unknown, operation: string) {
  const id = correlationId(req);
  logger.error({ error, operation, correlationId: id, adminId: actorId(req) }, "[AdminArtistGovernance] Mutation failed");
  return res.status(500).json({
    success: false,
    code: "ADMIN_ARTIST_MUTATION_FAILED",
    message: "Artist update failed",
    correlationId: id,
  });
}

router.post("/create", async (req: any, res: any) => {
  const id = correlationId(req);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const temporaryPassword = String(req.body?.temporaryPassword || "");
  const name = req.body?.name == null ? null : String(req.body.name).trim();
  if (!email || !temporaryPassword) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_CREATE", message: "Email and temporaryPassword are required", correlationId: id });
  }

  const revenueShare = req.body?.revenueSharePercentage == null
    ? 90
    : Number(req.body.revenueSharePercentage);
  const subscriptionPrice = req.body?.subscriptionPrice == null
    ? 0
    : Number(req.body.subscriptionPrice);
  if (!Number.isFinite(revenueShare) || revenueShare < 0 || revenueShare > 100 || !Number.isFinite(subscriptionPrice) || subscriptionPrice < 0) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_CREATE", message: "Invalid revenue share or subscription price", correlationId: id });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1", [email]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, code: "EMAIL_EXISTS", message: "Email already exists", correlationId: id });
    }

    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const inserted = await client.query(
      `INSERT INTO users (
         email, password, name, role, status, is_verified, verified,
         phone, genre, bio, social_links, revenue_share_percentage,
         admin_remarks, subscription_price, created_at, updated_at
       ) VALUES ($1, $2, $3, 'ARTIST', 'ACTIVE', false, false,
                 $4, $5, $6, $7, $8, $9, $10, now(), now())
       RETURNING id, email, name, role, status, is_verified, verified,
                 phone, genre, bio, social_links, revenue_share_percentage,
                 admin_remarks, subscription_price, created_at, updated_at`,
      [
        email,
        passwordHash,
        name,
        req.body?.phone ?? null,
        req.body?.genre ?? null,
        req.body?.bio ?? null,
        req.body?.socialLinks ? JSON.stringify(req.body.socialLinks) : null,
        revenueShare,
        req.body?.adminRemarks ?? null,
        subscriptionPrice,
      ]
    );
    const artist = inserted.rows[0];
    await client.query(
      `INSERT INTO artist_stats (artist_id, total_plays, total_subscribers, total_earnings, created_at, updated_at)
       VALUES ($1, 0, 0, 0, now(), now())
       ON CONFLICT (artist_id) DO NOTHING`,
      [artist.id]
    );
    await AuditService.logCritical({
      action: "admin.artist_created",
      entity: "user",
      entityId: String(artist.id),
      performedBy: actorId(req),
      role: "admin",
      status: "success",
      correlationId: id,
      metadata: { email, artistName: name, revenueSharePercentage: revenueShare, subscriptionPrice },
    }, client);
    await client.query("COMMIT");
    await invalidateArtistCache();
    return res.status(201).json({
      success: true,
      artist: {
        id: artist.id,
        name: artist.name ?? name,
        email: artist.email,
        role: String(artist.role),
        status: String(artist.status),
        isVerified: Boolean(artist.is_verified ?? artist.verified ?? false),
        phone: artist.phone ?? null,
        genre: artist.genre ?? null,
        bio: artist.bio ?? null,
        socialLinks: artist.social_links ?? null,
        revenueSharePercentage: Number(artist.revenue_share_percentage ?? revenueShare),
        adminRemarks: artist.admin_remarks ?? null,
        subscriptionPrice: Number(artist.subscription_price ?? subscriptionPrice),
        createdAt: artist.created_at ?? null,
        updatedAt: artist.updated_at ?? null,
      },
      correlationId: id,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "artist.create");
  } finally {
    client.release();
  }
});

router.patch("/:id/soft-delete", async (req: any, res: any) => {
  const id = positiveId(req.params.id);
  const correlation = correlationId(req);
  const reason = String(req.body?.reason || req.body?.deletionReason || "").trim();
  if (!id || !reason) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_DEACTIVATION", message: "Valid artist id and deletion reason are required", correlationId: correlation });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id, status, is_deleted, deletion_reason FROM users WHERE id = $1 AND UPPER(role) = 'ARTIST' FOR UPDATE", [id]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlation });
    }
    const updated = await client.query(
      `UPDATE users SET is_deleted = true, deleted_at = now(), deletion_reason = $2, updated_at = now()
        WHERE id = $1 RETURNING id, is_deleted, deleted_at, deletion_reason`,
      [id, reason]
    );
    await AuditService.logCritical({
      action: "admin.artist_status_changed", entity: "user", entityId: String(id), performedBy: actorId(req), role: "admin", status: "success", correlationId: correlation,
      metadata: { action: "soft_delete", previousStatus: current.rows[0].status, previousIsDeleted: Boolean(current.rows[0].is_deleted), deletionReason: reason },
    }, client);
    await client.query("COMMIT");
    await invalidateArtistCache();
    return res.json({ success: true, artist: { id, isDeleted: Boolean(updated.rows[0].is_deleted), deletedAt: updated.rows[0].deleted_at, deletionReason: updated.rows[0].deletion_reason }, correlationId: correlation });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "artist.soft-delete");
  } finally {
    client.release();
  }
});

router.patch("/:id/reactivate", async (req: any, res: any) => {
  const id = positiveId(req.params.id);
  const correlation = correlationId(req);
  if (!id) return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId: correlation });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id, status, is_deleted, deletion_reason FROM users WHERE id = $1 AND UPPER(role) = 'ARTIST' FOR UPDATE", [id]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlation });
    }
    const updated = await client.query(
      `UPDATE users SET is_deleted = false, deleted_at = NULL, deletion_reason = NULL, status = 'ACTIVE', updated_at = now()
        WHERE id = $1 RETURNING id, is_deleted, deleted_at, deletion_reason`,
      [id]
    );
    await AuditService.logCritical({
      action: "admin.artist_status_changed", entity: "user", entityId: String(id), performedBy: actorId(req), role: "admin", status: "success", correlationId: correlation,
      metadata: { action: "reactivate", previousStatus: current.rows[0].status, previousIsDeleted: Boolean(current.rows[0].is_deleted), previousDeletionReason: current.rows[0].deletion_reason },
    }, client);
    await client.query("COMMIT");
    await invalidateArtistCache();
    return res.json({ success: true, artist: { id, isDeleted: Boolean(updated.rows[0].is_deleted), deletedAt: updated.rows[0].deleted_at, deletionReason: updated.rows[0].deletion_reason }, correlationId: correlation });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "artist.reactivate");
  } finally {
    client.release();
  }
});

router.patch("/:id/status", async (req: any, res: any) => {
  const id = positiveId(req.params.id);
  const correlation = correlationId(req);
  if (!id) return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId: correlation });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id, status, is_deleted FROM users WHERE id = $1 AND UPPER(role) = 'ARTIST' FOR UPDATE", [id]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlation });
    }
    const wasInactive = Boolean(current.rows[0].is_deleted) || String(current.rows[0].status || "").toUpperCase() === "SUSPENDED";
    const reason = String(req.body?.reason || "").trim();
    if (wasInactive) {
      await client.query("UPDATE users SET status = 'ACTIVE', is_deleted = false, deleted_at = NULL, deletion_reason = NULL, updated_at = now() WHERE id = $1", [id]);
    } else {
      await client.query("UPDATE users SET status = 'ACTIVE', is_deleted = true, deleted_at = now(), deletion_reason = COALESCE(NULLIF($2, ''), 'Deactivated by admin'), updated_at = now() WHERE id = $1", [id, reason]);
    }
    await AuditService.logCritical({
      action: "admin.artist_status_changed", entity: "user", entityId: String(id), performedBy: actorId(req), role: "admin", status: "success", correlationId: correlation,
      metadata: { action: wasInactive ? "activate" : "deactivate", previousStatus: current.rows[0].status, previousIsDeleted: Boolean(current.rows[0].is_deleted), reason: reason || undefined },
    }, client);
    await client.query("COMMIT");
    await invalidateCachePattern("artist_search:*");
    await invalidateArtistCache();
    return res.json({ success: true, status: "ACTIVE", isDeleted: !wasInactive, correlationId: correlation });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "artist.status");
  } finally {
    client.release();
  }
});

router.patch("/:id/verified", async (req: any, res: any) => {
  const id = positiveId(req.params.id);
  const correlation = correlationId(req);
  if (!id) return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId: correlation });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id, is_verified, verified FROM users WHERE id = $1 AND UPPER(role) = 'ARTIST' FOR UPDATE", [id]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlation });
    }
    const previous = Boolean(current.rows[0].is_verified ?? current.rows[0].verified ?? false);
    const next = typeof req.body?.isVerified === "boolean" ? req.body.isVerified : !previous;
    await client.query("UPDATE users SET is_verified = $2, verified = $2, updated_at = now() WHERE id = $1", [id, next]);
    await AuditService.logCritical({
      action: "admin.artist_verification_changed", entity: "user", entityId: String(id), performedBy: actorId(req), role: "admin", status: "success", correlationId: correlation,
      metadata: { previousIsVerified: previous, isVerified: next },
    }, client);
    await client.query("COMMIT");
    await invalidateCachePattern("artist_search:*");
    await invalidateArtistCache();
    return res.json({ success: true, isVerified: next, correlationId: correlation });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "artist.verified");
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req: any, res: any) => {
  const id = positiveId(req.params.id);
  const correlation = correlationId(req);
  if (!id) return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId: correlation });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT id, name, email, phone, genre, bio, social_links, revenue_share_percentage,
              subscription_price, admin_remarks, profile_image_url, banner_image_url,
              is_verified, verified, status, created_at, updated_at, last_login
         FROM users WHERE id = $1 AND UPPER(role) = 'ARTIST' FOR UPDATE`,
      [id]
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlation });
    }

    const socialLinks = req.body?.socialLinks === undefined
      ? current.social_links
      : req.body.socialLinks === null
        ? null
        : req.body.socialLinks;
    const nextRevenueShare = req.body?.revenueSharePercentage === undefined || req.body?.revenueSharePercentage === null
      ? current.revenue_share_percentage
      : Number(req.body.revenueSharePercentage);
    const nextSubscriptionPrice = req.body?.subscriptionPrice === undefined || req.body?.subscriptionPrice === null
      ? current.subscription_price
      : Number(req.body.subscriptionPrice);

    const updatedResult = await client.query(
      `UPDATE users SET
         name = COALESCE($2, name), phone = COALESCE($3, phone), genre = COALESCE($4, genre),
         bio = COALESCE($5, bio), social_links = $6::jsonb,
         revenue_share_percentage = $7, subscription_price = $8,
         admin_remarks = COALESCE($9, admin_remarks), updated_at = now()
       WHERE id = $1
       RETURNING id, name, email, phone, genre, bio, social_links, revenue_share_percentage,
                 admin_remarks, subscription_price, created_at, updated_at,
                 profile_image_url, banner_image_url, is_verified, verified, status, last_login`,
      [
        id,
        req.body?.name ?? null,
        req.body?.phone ?? null,
        req.body?.genre ?? null,
        req.body?.bio ?? null,
        socialLinks === null ? null : JSON.stringify(socialLinks),
        nextRevenueShare,
        nextSubscriptionPrice,
        req.body?.adminRemarks ?? null,
      ]
    );
    const updated = updatedResult.rows[0];
    const changedFields = ["name", "phone", "genre", "bio", "socialLinks", "revenueSharePercentage", "subscriptionPrice", "adminRemarks"]
      .filter((field) => req.body?.[field] !== undefined);
    await AuditService.logCritical({
      action: "admin.artist_updated", entity: "user", entityId: String(id), performedBy: actorId(req), role: "admin", status: "success", correlationId: correlation,
      metadata: {
        changedFields,
        previousRevenueSharePercentage: Number(current.revenue_share_percentage || 0),
        nextRevenueSharePercentage: Number(updated.revenue_share_percentage || 0),
        previousSubscriptionPrice: Number(current.subscription_price || 0),
        nextSubscriptionPrice: Number(updated.subscription_price || 0),
      },
    }, client);
    await client.query("COMMIT");
    await invalidateArtistCache();
    return res.json({
      success: true,
      artist: {
        id: updated.id,
        name: updated.name ?? null,
        email: updated.email,
        profileImage: updated.profile_image_url ?? null,
        bannerImage: updated.banner_image_url ?? null,
        isVerified: Boolean(updated.is_verified ?? updated.verified ?? false),
        subscriptionPrice: Number(updated.subscription_price || 0),
        phone: updated.phone ?? null,
        genre: updated.genre ?? null,
        bio: updated.bio ?? "",
        socialLinks: updated.social_links ?? null,
        revenueSharePercentage: Number(updated.revenue_share_percentage || 0),
        adminRemarks: updated.admin_remarks ?? null,
        status: String(updated.status || "ACTIVE"),
        accountCreatedDate: updated.created_at ?? null,
        accountUpdatedDate: updated.updated_at ?? null,
        lastLogin: updated.last_login ?? null,
      },
      correlationId: correlation,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "artist.update");
  } finally {
    client.release();
  }
});

export default router;
