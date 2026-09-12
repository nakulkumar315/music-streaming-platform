import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { getMediaConfig } from "../../config/media.config";
import { requestPlaybackAccess } from "../media/media-access.service";
import { isContentEligibleForPlayback } from "../media/media-policy.service";
import { getStorageProviderByName } from "../../shared/storage/factory/storage-provider.factory";
import { resolveMediaIdentity } from "../../shared/media/media-asset-locator";
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

router.post("/access", requireAuth, requireFan, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const contentId = positiveInteger(req.body?.contentId);
  const userId = positiveInteger(req.user?.id);
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

  try {
    const result = await requestPlaybackAccess({
      contentId,
      userId,
      kind,
      quality,
      correlationId,
    });

    const mediaCfg = getMediaConfig();
    const configuredBase = String(mediaCfg.appBaseUrl || "").replace(/\/+$/, "");
    const requestBase = `${req.protocol}://${req.get("host")}`;
    const streamRoute = String(mediaCfg.localPrivateStreamRoute || "/media/stream").replace(/\/+$/, "");

    let playbackUrl = String(result.playbackUrl || "");
    if (configuredBase && playbackUrl.startsWith(configuredBase)) {
      playbackUrl = `${requestBase}${playbackUrl.slice(configuredBase.length)}`;
    }

    try {
      const parsed = new URL(playbackUrl);
      if (parsed.pathname.startsWith(streamRoute)) {
        playbackUrl = `${requestBase}${parsed.pathname}${parsed.search}`;
      }
    } catch {
      throw new Error("Protected playback URL is invalid");
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

/** Client should refresh the exact issued session every 30-60 seconds. */
router.post("/heartbeat", requireAuth, requireFan, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const userId = positiveInteger(req.user?.id);
  const sessionId = positiveInteger(req.body?.sessionId);
  const contentId = positiveInteger(req.body?.contentId);

  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
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
    return res.status(500).json({ success: false, message: "Heartbeat failed", correlationId });
  }
});

/** Explicitly revokes the exact playback session. */
router.post("/terminate", requireAuth, requireFan, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const userId = positiveInteger(req.user?.id);
  const sessionId = positiveInteger(req.body?.sessionId);
  const contentId = positiveInteger(req.body?.contentId);

  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
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
    return res.status(500).json({ success: false, message: "Failed to terminate playback", correlationId });
  }
});

/**
 * Fan artwork delivery. Thumbnails may be delivered without a playback session,
 * but only for approved/playable content and only through explicit provider
 * identity; raw legacy media URL fallbacks are intentionally not used.
 */
router.get("/thumbnail/:contentId", async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const contentId = positiveInteger(req.params?.contentId);
  if (!contentId) {
    return res.status(400).json({ success: false, message: "Invalid content id", correlationId });
  }

  try {
    const result = await pool.query(
      `SELECT id, status, lifecycle_state, is_approved, storage_provider,
              thumbnail_storage_key, thumbnail_provider_asset_id
         FROM content_items
        WHERE id = $1
        LIMIT 1`,
      [contentId]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ success: false, message: "Thumbnail not found", correlationId });

    const status = String(row.status || row.lifecycle_state || "DRAFT").toUpperCase();
    if (!isContentEligibleForPlayback(status, Boolean(row.is_approved))) {
      return res.status(404).json({ success: false, message: "Thumbnail not available", correlationId });
    }

    const storageProvider = String(row.storage_provider || "").trim().toLowerCase();
    if (!storageProvider) {
      return res.status(409).json({ success: false, message: "Thumbnail storage is not configured", correlationId });
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

    if (!storageKey) {
      return res.status(404).json({ success: false, message: "Thumbnail mapping incomplete", correlationId });
    }

    const metadata = await storage.getObjectMetadata(storageKey);
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
    return res.status(502).json({ success: false, message: "Failed to load thumbnail", correlationId });
  }
});

export default router;
