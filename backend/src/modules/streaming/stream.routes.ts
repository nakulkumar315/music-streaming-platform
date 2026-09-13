import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { logger } from "../../common/logger";
import {
  playbackAccessLimiter,
  playbackHeartbeatLimiter,
} from "../../common/security/rateLimit";
import { getMediaConfig } from "../../config/media.config";
import { requestPlaybackAccess } from "../media/media-access.service";
import { isContentEligibleForPlayback } from "../media/media-policy.service";
import { getStorageProviderByName } from "../../shared/storage/factory/storage-provider.factory";
import { resolveMediaIdentity } from "../../shared/media/media-asset-locator";
import { getContentForAccess } from "../../shared/security/media-authz.service";
import {
  heartbeatPlaybackSession,
  terminatePlaybackSession,
} from "../../shared/security/playback-session.service";
import { mapStreamAccessError } from "./stream-access-error";

const router = Router();
const requireFan = requireRoles("FAN");

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

router.post("/access", requireAuth, requireFan, playbackAccessLimiter, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const contentId = positiveInteger(req.body?.contentId);
  const userId = positiveInteger(req.user?.id);
  const hasSessionId =
    req.body?.sessionId !== undefined &&
    req.body?.sessionId !== null &&
    String(req.body?.sessionId).trim() !== "";
  const sessionId = hasSessionId ? positiveInteger(req.body?.sessionId) : undefined;
  const kindRaw = String(req.body?.kind || "").trim().toLowerCase();
  const kind = kindRaw === "video" ? "video" : kindRaw === "audio" ? "audio" : undefined;
  const quality = String(req.body?.quality || "Auto").trim();

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized", correlationId });
  }
  if (!contentId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CONTENT_ID",
      message: "contentId is required",
      correlationId,
    });
  }
  if (hasSessionId && !sessionId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_PLAYBACK_SESSION",
      message: "sessionId must be a positive integer",
      correlationId,
    });
  }

  try {
    const result = await requestPlaybackAccess({
      contentId,
      userId,
      sessionId,
      kind,
      quality,
      correlationId,
    });

    const mediaCfg = getMediaConfig();
    const configuredBase = new URL(mediaCfg.appBaseUrl);
    const streamRoute = String(mediaCfg.localPrivateStreamRoute || "/media/stream").replace(/\/+$/, "");
    const playbackUrl = String(result.playbackUrl || "").trim();

    let parsed: URL;
    try {
      parsed = new URL(playbackUrl);
    } catch {
      throw new Error("Protected playback URL is invalid");
    }

    // Local/private delivery URLs must remain on the trusted configured public
    // origin. Never rewrite them from Host/X-Forwarded-Host request headers.
    if (parsed.pathname.startsWith(streamRoute) && parsed.origin !== configuredBase.origin) {
      throw new Error("Protected playback URL origin does not match APP_BASE_URL");
    }

    return res.json({
      success: true,
      mediaId: result.mediaId,
      sessionId: result.sessionId,
      playbackUrl,
      expiresIn: result.expiresIn,
      contentType: result.contentType,
      contentLength: result.contentLength,
      correlationId,
    });
  } catch (error: any) {
    const mapped = mapStreamAccessError(error);
    const logPayload = {
      correlationId,
      userId,
      contentId,
      sessionId,
      code: mapped.code,
      error: error?.message,
    };
    if (mapped.status >= 500) logger.error(logPayload, "[stream/access] failed");
    else logger.warn(logPayload, "[stream/access] rejected");

    return res.status(mapped.status).json({
      success: false,
      code: mapped.code,
      message: mapped.message,
      correlationId,
    });
  }
});

router.post("/heartbeat", requireAuth, requireFan, playbackHeartbeatLimiter, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const userId = positiveInteger(req.user?.id);
  const sessionId = positiveInteger(req.body?.sessionId);
  const contentId = positiveInteger(req.body?.contentId);

  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized", correlationId });
  if (!sessionId || !contentId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_PLAYBACK_SESSION",
      message: "sessionId and contentId are required",
      correlationId,
    });
  }

  try {
    const lastSeen = await heartbeatPlaybackSession({
      sessionId,
      userId,
      contentId,
      currentPosition: req.body?.currentPosition,
      duration: req.body?.duration,
    });

    if (!lastSeen) {
      return res.status(409).json({
        success: false,
        code: "PLAYBACK_SESSION_EXPIRED",
        message: "Playback session is no longer active. Request playback access again.",
        correlationId,
      });
    }

    return res.json({
      success: true,
      sessionId,
      lastSeen: lastSeen.toISOString(),
      correlationId,
    });
  } catch (error: any) {
    logger.error({ error, userId, sessionId, contentId, correlationId }, "[stream/heartbeat] failed");
    return res.status(500).json({
      success: false,
      code: "PLAYBACK_HEARTBEAT_FAILED",
      message: "Heartbeat failed",
      correlationId,
    });
  }
});

router.post("/terminate", requireAuth, requireFan, playbackHeartbeatLimiter, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const userId = positiveInteger(req.user?.id);
  const sessionId = positiveInteger(req.body?.sessionId);
  const contentId = positiveInteger(req.body?.contentId);

  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized", correlationId });
  if (!sessionId || !contentId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_PLAYBACK_SESSION",
      message: "sessionId and contentId are required",
      correlationId,
    });
  }

  try {
    const terminated = await terminatePlaybackSession({ sessionId, userId, contentId });
    return res.json({ success: true, terminated, correlationId });
  } catch (error: any) {
    logger.error({ error, userId, sessionId, contentId, correlationId }, "[stream/terminate] failed");
    return res.status(500).json({
      success: false,
      code: "PLAYBACK_TERMINATE_FAILED",
      message: "Failed to terminate playback",
      correlationId,
    });
  }
});

/**
 * Artwork may be public, but only for content that is currently eligible for
 * fan discovery/playback. The canonical access record also enforces the
 * owning artist's current approval/account state.
 */
router.get("/thumbnail/:contentId", async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const contentId = positiveInteger(req.params?.contentId);
  if (!contentId) {
    return res.status(400).json({ success: false, code: "INVALID_CONTENT_ID", message: "Invalid content id", correlationId });
  }

  try {
    const row = await getContentForAccess(contentId);
    if (!row) {
      return res.status(404).json({ success: false, code: "THUMBNAIL_NOT_FOUND", message: "Thumbnail not found", correlationId });
    }

    if (
      !isContentEligibleForPlayback({
        technicalStatus: String(row.status || ""),
        lifecycleState: String(row.lifecycle_state || ""),
        isApproved: Boolean(row.is_approved),
        isTakenDown: Boolean(row.is_taken_down),
      })
    ) {
      return res.status(404).json({ success: false, code: "THUMBNAIL_NOT_AVAILABLE", message: "Thumbnail not available", correlationId });
    }

    const storageProvider = String(row.storage_provider || "").trim().toLowerCase();
    if (!storageProvider) {
      return res.status(409).json({ success: false, code: "THUMBNAIL_STORAGE_MISSING", message: "Thumbnail storage is not configured", correlationId });
    }

    const identity = resolveMediaIdentity(row, "thumbnail");
    const storageKey = identity.internalStorageKey;
    const providerAssetId = identity.providerAssetId;
    const storage = getStorageProviderByName(storageProvider as any);

    if (providerAssetId && storage.getPublicObjectUrl) {
      const url = await storage.getPublicObjectUrl({
        providerAssetId,
        mediaType: "thumbnail",
      });
      if (url) return res.redirect(302, url);
    }

    if (!storageKey || !storage.openReadStream) {
      return res.status(404).json({ success: false, code: "THUMBNAIL_MAPPING_INCOMPLETE", message: "Thumbnail mapping incomplete", correlationId });
    }

    const metadata = await storage.getObjectMetadata(storageKey, providerAssetId || undefined);
    const read = await storage.openReadStream({ storageKey });
    const contentType = metadata?.contentType || read?.contentType;
    const contentLength = metadata?.contentLength ?? read?.contentLength;
    if (contentType) res.setHeader("Content-Type", contentType);
    if (contentLength !== undefined) res.setHeader("Content-Length", String(contentLength));
    res.setHeader("Cache-Control", "public, max-age=300");
    read.stream.on("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    return read.stream.pipe(res);
  } catch (error: any) {
    logger.error({ error, contentId, correlationId }, "[stream/thumbnail] failed");
    return res.status(502).json({ success: false, code: "THUMBNAIL_LOAD_FAILED", message: "Failed to load thumbnail", correlationId });
  }
});

export default router;
