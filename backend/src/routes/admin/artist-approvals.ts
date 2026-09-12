import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { pool } from "../../common/db";
import { invalidateArtistCache } from "../../common/cache";
import { logger } from "../../common/logger";
import { AuditService } from "../../shared/audit/audit.service";
import {
  ArtistApprovalDecision,
  ArtistApprovalService,
} from "../../modules/artist/artist-approval.service";

const router = Router();
const requireAdmin = requireRoles("ADMIN");

const safeQuery = async <T = any>(query: string, params: any[]): Promise<T[]> => {
  try {
    const r = await pool.query(query, params);
    return (r.rows as T[]) ?? [];
  } catch {
    return [];
  }
};

router.get("/pending-artists", requireAuth, requireAdmin, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";

  try {
    const rows = await safeQuery<any>(
      `SELECT
         id,
         COALESCE(NULLIF(name, ''), NULLIF(split_part(email, '@', 1), ''), email) as name,
         email,
         created_at,
         onboarded_at,
         COALESCE(artist_status::text, 'PENDING') as artist_status,
         COALESCE(artist_bio, bio, '') as artist_bio,
         portfolio_links,
         artist_appeal_message,
         admin_remarks
       FROM users
       WHERE role = 'ARTIST'
         AND (
           COALESCE(artist_status::text, 'PENDING') = 'PENDING'
           OR (
             artist_status::text = 'REJECTED'
             AND NULLIF(TRIM(COALESCE(artist_appeal_message, '')), '') IS NOT NULL
           )
         )
       ORDER BY COALESCE(onboarded_at, created_at) DESC
       LIMIT 300`,
      []
    );

    const items = rows.map((u) => {
      const status = (u.artist_status ?? "PENDING").toString().toUpperCase();
      const appeal = (u.artist_appeal_message ?? "").toString().trim();
      return {
        id: Number(u.id),
        name: u.name ?? null,
        email: u.email,
        submittedAt: u.onboarded_at ?? u.created_at ?? null,
        artistStatus: status,
        artistBio: u.artist_bio ?? "",
        portfolioLinks: Array.isArray(u.portfolio_links) ? u.portfolio_links : [],
        appealMessage: u.artist_appeal_message ?? null,
        appealed: status === "REJECTED" && Boolean(appeal),
        adminNote: u.admin_remarks ?? null,
      };
    });

    return res.json({ success: true, items, correlationId });
  } catch {
    logger.error({ correlationId }, "[ADMIN] pending-artists failed");
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending artists",
      correlationId,
    });
  }
});

router.patch("/resolve-artist/:id", requireAuth, requireAdmin, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const artistId = Number(req.params.id);
  const action = String(req.body?.action || "").trim().toUpperCase() as ArtistApprovalDecision;
  const reason = String(req.body?.reason || "").trim();

  try {
    const result = await ArtistApprovalService.resolve({
      artistId,
      action,
      reason,
    });

    // Public artist visibility depends on verified + APPROVED, so either
    // decision must evict discovery/detail caches immediately.
    await invalidateArtistCache();

    AuditService.log({
      action:
        result.status === "APPROVED"
          ? "admin.artist_approved"
          : "admin.artist_rejected",
      entity: "user",
      entityId: String(result.artistId),
      performedBy: req.user?.id,
      role: "admin",
      status: "success",
      correlationId,
      metadata: {
        action: result.status.toLowerCase(),
        previousStatus: result.previousStatus,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    });

    logger.info(
      {
        correlationId,
        artistId: result.artistId,
        previousStatus: result.previousStatus,
        status: result.status,
      },
      "[ADMIN] Artist approval resolved"
    );

    return res.json({
      success: true,
      status: result.status,
      correlationId,
    });
  } catch (error: any) {
    const status = [400, 404, 409].includes(Number(error?.status))
      ? Number(error.status)
      : 500;

    logger.error(
      { correlationId, artistId, action, code: error?.code || "SYSTEM_ERROR" },
      "[ADMIN] resolve-artist failed"
    );

    return res.status(status).json({
      success: false,
      code: error?.code || "SYSTEM_ERROR",
      message:
        status === 500
          ? "Failed to resolve artist"
          : String(error?.message || "Unable to resolve artist"),
      correlationId,
    });
  }
});

export default router;
