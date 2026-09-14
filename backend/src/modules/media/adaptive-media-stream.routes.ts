import { Router, type Request, type Response, type NextFunction } from "express";
import { generatePlaybackAccess } from "../../shared/delivery/services/media-delivery.service";
import {
  checkMediaEntitlement,
  getContentForAccess,
  validateQualityAccess,
  type ContentForAccess,
  type VisibilityType,
} from "../../shared/security/media-authz.service";
import { isPlaybackSessionActive } from "../../shared/security/playback-session.service";
import { verifyPlaybackToken } from "../../shared/security/signed-media-token.service";
import { verifyHlsResourceToken } from "../../shared/security/hls-resource-token.service";
import { MediaInvalidTokenException } from "../../shared/exceptions/media.exception";
import { resolveMediaIdentity } from "../../shared/media/media-asset-locator";
import {
  isContentEligibleForPlayback,
  normalizeVisibilityForPlayback,
} from "./media-policy.service";
import { proxyHlsResource } from "./hls-proxy.service";

const router = Router();
const QUALITY_ORDER = ["144p", "240p", "360p", "480p", "720p", "1080p"] as const;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function protectedHeaders(res: Response) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

async function authorizeCurrentPlayback(input: {
  mediaId: number;
  userId: number;
  sessionId: number;
}): Promise<{ content: ContentForAccess; visibility: VisibilityType }> {
  const sessionActive = await isPlaybackSessionActive(
    input.sessionId,
    input.userId,
    input.mediaId
  );
  if (!sessionActive) throw new MediaInvalidTokenException("Playback session is no longer active");

  const content = await getContentForAccess(input.mediaId);
  if (!content) throw new MediaInvalidTokenException("Playback content is no longer available");
  if (
    !isContentEligibleForPlayback({
      technicalStatus: String(content.status || ""),
      lifecycleState: String(content.lifecycle_state || ""),
      isApproved: Boolean(content.is_approved),
      isTakenDown: Boolean(content.is_taken_down),
    })
  ) {
    throw new MediaInvalidTokenException("Playback content is no longer authorized");
  }

  const visibility = normalizeVisibilityForPlayback(content.visibility || "PROTECTED");
  if (!visibility) throw new MediaInvalidTokenException("Playback visibility is invalid");

  const entitlement = await checkMediaEntitlement(
    input.userId,
    Number(content.artist_id),
    visibility,
    Boolean(content.subscription_required)
  );
  if (!entitlement.allowed) {
    throw new MediaInvalidTokenException(entitlement.reason || "Playback entitlement revoked");
  }

  return { content, visibility };
}

function actualQualities(content: ContentForAccess) {
  const available = new Set(
    Array.isArray(content.adaptive_qualities)
      ? content.adaptive_qualities.map((value) => String(value))
      : []
  );
  return QUALITY_ORDER.filter((quality) => available.has(quality));
}

/**
 * Initial protected Cloudinary-video boundary. It intentionally intercepts only
 * adaptive Cloudinary VIDEO requests; progressive audio/other providers fall
 * through to the existing protected stream router.
 */
router.get("/:mediaId", async (req: Request, res: Response, next: NextFunction) => {
  const mediaId = positiveInteger(req.params.mediaId);
  const kind = String(req.query.kind || "audio").trim().toLowerCase();
  if (!mediaId || kind !== "video") return next();

  const token = String(req.query.token || "").trim();
  if (!token) return next();

  let payload;
  try {
    payload = verifyPlaybackToken(token);
  } catch {
    return next();
  }
  if (payload.mediaId !== mediaId) return next();

  protectedHeaders(res);
  try {
    const { content, visibility } = await authorizeCurrentPlayback({
      mediaId,
      userId: payload.userId,
      sessionId: payload.sessionId,
    });
    const storageProvider = String(content.storage_provider || "").trim().toLowerCase();
    if (storageProvider !== "cloudinary") return next();

    if (String(content.adaptive_status || "").toUpperCase() !== "READY") {
      return res.status(409).json({
        success: false,
        code: "ADAPTIVE_MEDIA_NOT_READY",
        message: "Adaptive video is still processing or unavailable",
      });
    }

    const providerAssetId = resolveMediaIdentity(content, "video").providerAssetId;
    if (!providerAssetId) {
      return res.status(409).json({
        success: false,
        code: "ADAPTIVE_MEDIA_MAPPING_INCOMPLETE",
        message: "Adaptive video mapping is incomplete",
      });
    }

    const parsedQuality = await validateQualityAccess(payload.userId, String(req.query.quality || "Auto"));
    const available = actualQualities(content);
    let quality = parsedQuality.quality;
    if (quality === "Auto") {
      quality = available.length > 1 ? "Auto" : available[0];
    }
    if (!quality || (quality !== "Auto" && !available.includes(quality as any))) {
      return res.status(400).json({
        success: false,
        code: "INVALID_PLAYBACK_QUALITY",
        message: "Requested quality is not available for this content",
      });
    }

    const remainingSeconds = payload.exp - Math.floor(Date.now() / 1000);
    if (remainingSeconds <= 0) {
      return res.status(401).json({ success: false, code: "PLAYBACK_ACCESS_EXPIRED", message: "Playback access expired" });
    }

    const upstream = await generatePlaybackAccess({
      mediaId,
      storageProvider: "cloudinary",
      storageKey: "",
      providerAssetId,
      kind: "video",
      contentType: content.mime_type || undefined,
      contentLength: content.file_size_bytes || undefined,
      visibility,
      userId: payload.userId,
      expiresInSeconds: remainingSeconds,
      token,
      quality,
    });

    return proxyHlsResource({
      req,
      res,
      upstreamUrl: upstream.playbackUrl,
      mediaId,
      userId: payload.userId,
      sessionId: payload.sessionId,
      expiresAtEpochSeconds: payload.exp,
    });
  } catch (error: any) {
    return res.status(error instanceof MediaInvalidTokenException ? 401 : 502).json({
      success: false,
      code: error instanceof MediaInvalidTokenException ? "PLAYBACK_ACCESS_REVOKED" : "ADAPTIVE_DELIVERY_FAILED",
      message: error instanceof MediaInvalidTokenException ? error.message : "Adaptive media delivery failed",
    });
  }
});

/** Every rewritten manifest/segment/key URI passes this live authorization gate. */
router.get("/:mediaId/hls", async (req: Request, res: Response) => {
  protectedHeaders(res);
  const mediaId = positiveInteger(req.params.mediaId);
  const resource = String(req.query.resource || "").trim();
  if (!mediaId || !resource) {
    return res.status(400).json({ success: false, code: "INVALID_ADAPTIVE_RESOURCE", message: "Invalid adaptive resource" });
  }

  try {
    const payload = verifyHlsResourceToken(resource);
    if (payload.mediaId !== mediaId) {
      throw new MediaInvalidTokenException("Adaptive resource media mismatch");
    }
    const { content } = await authorizeCurrentPlayback({
      mediaId,
      userId: payload.userId,
      sessionId: payload.sessionId,
    });
    if (
      String(content.storage_provider || "").toLowerCase() !== "cloudinary" ||
      String(content.adaptive_status || "").toUpperCase() !== "READY"
    ) {
      return res.status(409).json({
        success: false,
        code: "ADAPTIVE_MEDIA_NOT_READY",
        message: "Adaptive media is unavailable",
      });
    }

    return proxyHlsResource({
      req,
      res,
      upstreamUrl: payload.upstreamUrl,
      mediaId,
      userId: payload.userId,
      sessionId: payload.sessionId,
      expiresAtEpochSeconds: payload.exp,
    });
  } catch (error: any) {
    return res.status(error instanceof MediaInvalidTokenException ? 401 : 502).json({
      success: false,
      code: error instanceof MediaInvalidTokenException ? "INVALID_ADAPTIVE_TOKEN" : "ADAPTIVE_DELIVERY_FAILED",
      message: error instanceof MediaInvalidTokenException ? error.message : "Adaptive media delivery failed",
    });
  }
});

export default router;
