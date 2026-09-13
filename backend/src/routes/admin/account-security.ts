import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { ArtistAccountStateService } from "../../common/auth/account-state.service";
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

function auditContext(req: any, reason?: string) {
  return {
    actorId: Number(req.user?.id),
    actorRole: "admin" as const,
    correlationId: auditCorrelationId(req),
    ...(reason ? { reason } : {}),
  };
}

function sendStateError(res: any, error: any, correlationId: string) {
  const status = [400, 401, 404, 409].includes(Number(error?.status)) ? Number(error.status) : 500;
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

// These routes are mounted before the historical admin artist/content routers.
// Each privileged mutation passes actor context into the canonical account-state
// transaction so state change, session revocation and audit persistence are one
// atomic operation.
router.patch("/artists/:id/soft-delete", requireAuth, requireAdmin, async (req: any, res) => {
  const id = artistId(req.params.id);
  const correlationId = responseCorrelationId(req);
  if (!id) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId });
  }

  const reason = String(req.body?.reason ?? req.body?.deletionReason ?? "").trim();
  try {
    const state = await ArtistAccountStateService.softDelete(
      id,
      reason,
      auditContext(req, reason)
    );
    await invalidateArtistStateCaches();
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
    const state = await ArtistAccountStateService.reactivate(id, auditContext(req));
    await invalidateArtistStateCaches();
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

  const reason = String(req.body?.reason || "").trim();
  try {
    const state = await ArtistAccountStateService.toggleSuspension(
      id,
      auditContext(req, reason || undefined)
    );
    await invalidateArtistStateCaches();
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

  const reason = String(req.body?.reason || "").trim();
  try {
    const state = await ArtistAccountStateService.ban(
      id,
      auditContext(req, reason || undefined)
    );
    await invalidateArtistStateCaches();
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