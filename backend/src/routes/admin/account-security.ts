import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { ArtistAccountStateService } from "../../common/auth/account-state.service";
import { AuditService } from "../../shared/audit/audit.service";
import { invalidateArtistCache, invalidateCachePattern } from "../../common/cache";

const router = Router();
const requireAdmin = requireRoles("ADMIN");

function artistId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function auditCorrelationId(req: any) {
  const value = String(req?.correlationId || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function responseCorrelationId(req: any) {
  return String(req?.correlationId || "-");
}

function sendStateError(res: any, error: any, correlationId: string) {
  const status = [400, 404, 409].includes(Number(error?.status)) ? Number(error.status) : 500;
  const code = error?.code || (status === 500 ? "SYSTEM_ERROR" : "ACCOUNT_STATE_ERROR");
  return res.status(status).json({
    success: false,
    code,
    message: status === 500 ? "Unable to update artist account state" : String(error?.message || "Unable to update artist account state"),
    correlationId,
  });
}

async function invalidateArtistStateCaches() {
  await Promise.all([
    invalidateArtistCache(),
    invalidateCachePattern("artist_search:*")
  ]);
}

function auditStateChange(req: any, state: any, reason?: string) {
  AuditService.log({
    action: "admin.artist_status_changed",
    entity: "user",
    entityId: String(state.id),
    performedBy: Number(req.user?.id),
    role: "admin",
    status: "success",
    correlationId: auditCorrelationId(req),
    metadata: {
      action: state.operation,
      status: state.status,
      isDeleted: state.isDeleted,
      sessionsRevoked: state.sessionsRevoked,
      ...(reason ? { reason } : {}),
    },
  });
}

// These routes are mounted before the historical admin artist/content routers.
// Guards are attached per intercepted path so unrelated MODERATOR routes fall
// through to their canonical content router instead of being blocked here.
router.patch("/artists/:id/soft-delete", requireAuth, requireAdmin, async (req: any, res) => {
  const id = artistId(req.params.id);
  const correlationId = responseCorrelationId(req);
  if (!id) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId });
  }

  const reason = String(req.body?.reason ?? req.body?.deletionReason ?? "").trim();
  try {
    const state = await ArtistAccountStateService.softDelete(id, reason);
    await invalidateArtistStateCaches();
    auditStateChange(req, state, reason);
    return res.json({
      success: true,
      artist: {
        id: state.id,
        status: state.status,
        isDeleted: state.isDeleted,
        deletedAt: state.deletedAt,
        deletionReason: state.deletionReason,
      },
      sessionsRevoked: state.sessionsRevoked,
      correlationId,
    });
  } catch (error: any) {
    return sendStateError(res, error, correlationId);
  }
});

router.patch("/artists/:id/reactivate", requireAuth, requireAdmin, async (req: any, res) => {
  const id = artistId(req.params.id);
  const correlationId = responseCorrelationId(req);
  if (!id) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId });
  }

  try {
    const state = await ArtistAccountStateService.reactivate(id);
    await invalidateArtistStateCaches();
    auditStateChange(req, state);
    return res.json({
      success: true,
      artist: {
        id: state.id,
        status: state.status,
        isDeleted: state.isDeleted,
        deletedAt: state.deletedAt,
        deletionReason: state.deletionReason,
      },
      sessionsRevoked: state.sessionsRevoked,
      reauthenticationRequired: true,
      correlationId,
    });
  } catch (error: any) {
    return sendStateError(res, error, correlationId);
  }
});

router.patch("/artists/:id/status", requireAuth, requireAdmin, async (req: any, res) => {
  const id = artistId(req.params.id);
  const correlationId = responseCorrelationId(req);
  if (!id) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId });
  }

  try {
    const state = await ArtistAccountStateService.toggleSuspension(id);
    await invalidateArtistStateCaches();
    auditStateChange(req, state, String(req.body?.reason || "").trim() || undefined);
    return res.json({
      success: true,
      status: state.status,
      isDeleted: state.isDeleted,
      sessionsRevoked: state.sessionsRevoked,
      reauthenticationRequired: state.operation === "activate",
      correlationId,
    });
  } catch (error: any) {
    return sendStateError(res, error, correlationId);
  }
});

router.post("/content/artists/:artistId/ban", requireAuth, requireAdmin, async (req: any, res) => {
  const id = artistId(req.params.artistId);
  const correlationId = responseCorrelationId(req);
  if (!id) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid artistId", correlationId });
  }

  try {
    const state = await ArtistAccountStateService.ban(id);
    await invalidateArtistStateCaches();
    auditStateChange(req, state, String(req.body?.reason || "").trim() || undefined);
    return res.json({
      success: true,
      status: state.status,
      isDeleted: state.isDeleted,
      sessionsRevoked: state.sessionsRevoked,
      correlationId,
    });
  } catch (error: any) {
    return sendStateError(res, error, correlationId);
  }
});

export default router;
