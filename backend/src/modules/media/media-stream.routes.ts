import { Router, Request, Response } from "express";
import { getMediaConfig } from "../../config/media.config";
import { generatePlaybackAccess } from "../../shared/delivery/services/media-delivery.service";
import { resolveMediaIdentity } from "../../shared/media/media-asset-locator";
import { getStorageProviderByName } from "../../shared/storage/factory/storage-provider.factory";
import {
  checkMediaEntitlement,
  getContentForAccess,
  validateQualityAccess,
  type VisibilityType,
} from "../../shared/security/media-authz.service";
import { isPlaybackSessionActive } from "../../shared/security/playback-session.service";
import { verifyPlaybackToken } from "../../shared/security/signed-media-token.service";
import { MediaInvalidTokenException } from "../../shared/exceptions/media.exception";
import {
  isContentEligibleForPlayback,
  normalizeVisibilityForPlayback,
} from "./media-policy.service";

const router = Router();

function inferContentTypeFromKey(storageKey: string | null | undefined): string | null {
  if (!storageKey) return null;
  const lower = storageKey.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return null;
}

router.get("/:mediaId", async (req: Request, res: Response) => {
  const mediaId = Number(req.params.mediaId);
  const token = String(req.query.token || "").trim();
  const kindRaw = String(req.query.kind || "audio").trim().toLowerCase();
  const kind: "audio" | "video" = kindRaw === "video" ? "video" : "audio";

  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid media id" });
  }
  if (!token) {
    return res.status(401).json({ success: false, message: "Playback token required" });
  }

  let payload;
  try {
    payload = verifyPlaybackToken(token);
  } catch (error: any) {
    const message =
      error instanceof MediaInvalidTokenException ? error.message : "Invalid playback token";
    return res.status(401).json({ success: false, message });
  }

  if (payload.mediaId !== mediaId) {
    return res.status(403).json({ success: false, message: "Playback token media mismatch" });
  }

  try {
    const sessionActive = await isPlaybackSessionActive(
      payload.sessionId,
      payload.userId,
      mediaId
    );
    if (!sessionActive) {
      return res.status(401).json({
        success: false,
        code: "PLAYBACK_SESSION_EXPIRED",
        message: "Playback session is no longer active",
      });
    }

    const content = await getContentForAccess(mediaId);
    if (!content) {
      return res.status(404).json({ success: false, message: "Media not found" });
    }

    const technicalStatus = String(content.status || "").toUpperCase();
    const lifecycleState = String(content.lifecycle_state || "DRAFT").toUpperCase();
    if (!isContentEligibleForPlayback({
      technicalStatus,
      lifecycleState,
      isApproved: Boolean(content.is_approved),
      isTakenDown: Boolean(content.is_taken_down),
    })) {
      return res.status(409).json({ success: false, message: "Media is not approved for playback" });
    }

    const visibility = normalizeVisibilityForPlayback(content.visibility || "PROTECTED");
    if (!visibility) {
      return res.status(403).json({ success: false, message: "Media visibility is invalid" });
    }

    const entitlement = await checkMediaEntitlement(
      payload.userId,
      Number(content.artist_id),
      visibility as VisibilityType,
      Boolean(content.subscription_required)
    );
    if (!entitlement.allowed) {
      return res.status(403).json({
        success: false,
        code: "ENTITLEMENT_REVOKED",
        message: entitlement.reason || "Playback access revoked",
      });
    }

    const storageProvider = String(content.storage_provider || "").trim().toLowerCase();
    const identity = resolveMediaIdentity(content, kind);
    const storageKey = identity.internalStorageKey;
    const providerAssetId = identity.providerAssetId;
    const quality = await validateQualityAccess(
      payload.userId,
      String(req.query.quality || "Auto")
    );

    const tokenRemainingSeconds = Math.max(
      1,
      payload.exp - Math.floor(Date.now() / 1000)
    );
    const providerTtlSeconds = Math.min(120, tokenRemainingSeconds);

    if (["cloudinary", "s3", "firebase"].includes(storageProvider)) {
      if (storageProvider === "cloudinary" && !providerAssetId) {
        return res.status(409).json({ success: false, message: "Provider asset mapping is incomplete" });
      }
      if (storageProvider !== "cloudinary" && !storageKey) {
        return res.status(409).json({ success: false, message: "Storage mapping is incomplete" });
      }

      const access = await generatePlaybackAccess({
        mediaId,
        storageProvider,
        storageKey: storageKey || "",
        providerAssetId: providerAssetId || undefined,
        kind,
        contentType: content.mime_type || undefined,
        contentLength: content.file_size_bytes || undefined,
        visibility,
        userId: payload.userId,
        expiresInSeconds: providerTtlSeconds,
        token,
        quality: quality.quality,
      });

      if (!access.playbackUrl) {
        return res.status(502).json({ success: false, message: "Provider playback URL unavailable" });
      }
      res.setHeader("Cache-Control", "private, no-store");
      return res.redirect(302, access.playbackUrl);
    }

    if (storageProvider !== "local") {
      return res.status(409).json({ success: false, message: "Unsupported media storage provider" });
    }
    if (!storageKey) {
      return res.status(409).json({ success: false, message: "Local media storage key missing" });
    }

    const storage = getStorageProviderByName("local");
    const metadata = await storage.getObjectMetadata(storageKey);
    if (!metadata) {
      return res.status(404).json({ success: false, message: "Media file not found" });
    }

    const totalLength = Number(metadata.contentLength || 0);
    if (!Number.isSafeInteger(totalLength) || totalLength <= 0) {
      return res.status(502).json({ success: false, message: "Invalid media metadata" });
    }

    const inferredType = inferContentTypeFromKey(storageKey);
    const contentType =
      metadata.contentType && metadata.contentType !== "application/octet-stream"
        ? metadata.contentType
        : inferredType || content.mime_type || "application/octet-stream";

    let start = 0;
    let end = totalLength - 1;
    let statusCode = 200;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match) {
        res.setHeader("Content-Range", `bytes */${totalLength}`);
        return res.status(416).end();
      }
      start = match[1] ? Number(match[1]) : 0;
      end = match[2] ? Number(match[2]) : totalLength - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        start >= totalLength
      ) {
        res.setHeader("Content-Range", `bytes */${totalLength}`);
        return res.status(416).end();
      }
      end = Math.min(end, totalLength - 1);
      statusCode = 206;
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "inline");

    if (statusCode === 206) {
      res.status(206);
      res.setHeader("Content-Length", String(end - start + 1));
      res.setHeader("Content-Range", `bytes ${start}-${end}/${totalLength}`);
    } else {
      res.setHeader("Content-Length", String(totalLength));
    }

    const read = await storage.openReadStream({ storageKey, start, end });
    read.stream.on("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    return read.stream.pipe(res);
  } catch (error) {
    return res.status(502).json({ success: false, message: "Protected media delivery failed" });
  }
});

export default router;
