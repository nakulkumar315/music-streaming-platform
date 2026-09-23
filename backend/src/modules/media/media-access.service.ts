/**
 * Canonical fan playback-access service.
 *
 * Authorization is evaluated before a playback session is allocated. Every
 * successful response points to the backend protected stream boundary; storage
 * provider URLs are never returned directly from this command.
 */

import { logger } from "../../common/logger";
import { getMediaConfig } from "../../config/media.config";
import { generatePlaybackAccess } from "../../shared/delivery/services/media-delivery.service";
import { DeliveryFailedException } from "../../shared/exceptions/delivery.exception";
import {
  MediaAccessDeniedException,
  MediaInvalidQualityException,
  MediaNotFoundException,
  MediaNotReadyException,
} from "../../shared/exceptions/media.exception";
import { resolveMediaIdentity } from "../../shared/media/media-asset-locator";
import {
  checkMediaEntitlement,
  getContentForAccess,
  validateQualityAccess,
  type VideoQuality,
  type VisibilityType,
} from "../../shared/security/media-authz.service";
import {
  createPlaybackSession,
  discardPlaybackSession,
  refreshPlaybackSessionLease,
} from "../../shared/security/playback-session.service";
import { createPlaybackToken } from "../../shared/security/signed-media-token.service";
import {
  isContentEligibleForPlayback,
  normalizeVisibilityForPlayback,
} from "./media-policy.service";
import type { PlaybackAccessResponse, PlaybackMode } from "./media.types";

export interface RequestPlaybackInput {
  contentId: number;
  userId: number;
  /**
   * Present only when refreshing the short-lived playback token for an already
   * active playback. A supplied lease must belong to this user/content and must
   * still be active; the service never silently allocates a replacement lease.
   */
  sessionId?: number;
  kind?: "audio" | "video";
  quality?: string;
  correlationId?: string;
}

const SUPPORTED_PROVIDERS = new Set(["local", "cloudinary", "s3", "firebase"]);
const QUALITY_ORDER: Exclude<VideoQuality, "Auto">[] = [
  "144p",
  "240p",
  "360p",
  "480p",
  "720p",
  "1080p",
];

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function actualAdaptiveQualities(raw: unknown): Exclude<VideoQuality, "Auto">[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.map((value) => String(value)));
  return QUALITY_ORDER.filter((quality) => set.has(quality));
}

export async function requestPlaybackAccess(
  input: RequestPlaybackInput
): Promise<PlaybackAccessResponse> {
  const contentId = positiveInteger(input.contentId);
  const userId = positiveInteger(input.userId);
  const requestedSessionId =
    input.sessionId === undefined ? null : positiveInteger(input.sessionId);
  const correlationId = input.correlationId || "-";
  if (!contentId) throw new MediaNotFoundException(String(input.contentId));
  if (!userId) {
    throw new MediaAccessDeniedException(
      "Authentication required",
      "AUTHENTICATION_REQUIRED"
    );
  }
  if (input.sessionId !== undefined && !requestedSessionId) {
    throw new MediaAccessDeniedException(
      "Playback session is invalid or expired",
      "PLAYBACK_SESSION_EXPIRED"
    );
  }

  const content = await getContentForAccess(contentId);
  if (!content) throw new MediaNotFoundException(contentId);

  const technicalStatus = String(content.status || "").toUpperCase();
  const lifecycleState = String(content.lifecycle_state || "").toUpperCase();
  if (
    !isContentEligibleForPlayback({
      technicalStatus,
      lifecycleState,
      isApproved: Boolean(content.is_approved),
      isTakenDown: Boolean(content.is_taken_down),
    })
  ) {
    const reason = content.is_taken_down
      ? "TAKEN_DOWN"
      : `${lifecycleState || "UNKNOWN"}/${technicalStatus || "UNKNOWN"}`;
    throw new MediaNotReadyException(contentId, reason);
  }

  const visibility = normalizeVisibilityForPlayback(content.visibility || "PROTECTED");
  if (!visibility) {
    throw new MediaAccessDeniedException(
      "Content visibility is invalid",
      "INVALID_VISIBILITY"
    );
  }

  const entitlement = await checkMediaEntitlement(
    userId,
    Number(content.artist_id),
    visibility as VisibilityType,
    Boolean(content.subscription_required)
  );
  if (!entitlement.allowed) {
    throw new MediaAccessDeniedException(
      entitlement.reason || "Playback access denied",
      entitlement.code || "ACCESS_DENIED"
    );
  }

  const requestedKind =
    input.kind === "video" ? "video" : input.kind === "audio" ? "audio" : null;
  const resolvedKind: "audio" | "video" =
    requestedKind ||
    (String(content.type || "").toLowerCase().includes("video") ? "video" : "audio");

  const storageProvider = String(content.storage_provider || "").trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(storageProvider)) {
    throw new MediaNotReadyException(contentId, "storage provider is not configured");
  }

  const identity = resolveMediaIdentity(content, resolvedKind);
  const storageKey = identity.internalStorageKey;
  const providerAssetId = identity.providerAssetId;

  if (storageProvider === "cloudinary") {
    if (!providerAssetId) {
      throw new MediaNotReadyException(contentId, "provider asset identity missing");
    }
  } else if (!storageKey) {
    throw new MediaNotReadyException(contentId, "storage key missing");
  }

  const parsedQuality = await validateQualityAccess(userId, input.quality);
  const availableAdaptiveQualities = actualAdaptiveQualities(content.adaptive_qualities);
  const adaptiveVideo = resolvedKind === "video" && storageProvider === "cloudinary";
  let playbackMode: PlaybackMode = "PROGRESSIVE";
  let selectedQuality: VideoQuality | undefined;
  let qualities: VideoQuality[] = [];
  let defaultQuality: VideoQuality | "ORIGINAL" = "ORIGINAL";

  if (adaptiveVideo) {
    const adaptiveStatus = String(content.adaptive_status || "").toUpperCase();
    if (adaptiveStatus !== "READY") {
      throw new MediaNotReadyException(contentId, `ADAPTIVE_${adaptiveStatus || "PENDING"}`);
    }
    if (!availableAdaptiveQualities.length) {
      throw new MediaNotReadyException(contentId, "ADAPTIVE_RENDITIONS_MISSING");
    }

    playbackMode = "HLS";
    qualities = [...availableAdaptiveQualities];
    const requested = parsedQuality.quality;
    if (requested === "Auto") {
      selectedQuality = availableAdaptiveQualities.length > 1
        ? "Auto"
        : availableAdaptiveQualities[0];
    } else if (availableAdaptiveQualities.includes(requested)) {
      selectedQuality = requested;
    } else {
      throw new MediaInvalidQualityException(
        `Quality ${requested} is not available for this content`
      );
    }
    defaultQuality = availableAdaptiveQualities.length > 1 ? "Auto" : availableAdaptiveQualities[0];
  } else if (resolvedKind === "video" && parsedQuality.quality !== "Auto") {
    // Progressive providers have no server-proven rendition ladder. Do not let
    // the client label arbitrary URLs as a requested quality.
    throw new MediaInvalidQualityException(
      "Manual quality selection is unavailable for progressive video"
    );
  }

  const config = getMediaConfig();
  const expiresInSeconds = config.mediaUrlTtlSeconds;
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + expiresInSeconds;

  // Playback authorization must never record listen time or play counts directly.
  // Audited consumption is exclusively owned by the trusted heartbeat path.
  let sessionId: number;
  let createdNewSession = false;
  if (requestedSessionId) {
    const refreshed = await refreshPlaybackSessionLease({
      sessionId: requestedSessionId,
      userId,
      contentId,
    });
    if (!refreshed) {
      throw new MediaAccessDeniedException(
        "Playback session is no longer active. Start playback again.",
        "PLAYBACK_SESSION_EXPIRED"
      );
    }
    sessionId = requestedSessionId;
  } else {
    sessionId = await createPlaybackSession(userId, contentId);
    createdNewSession = true;
  }

  try {
    const token = createPlaybackToken(
      contentId,
      userId,
      sessionId,
      expiresInSeconds
    );

    const access = await generatePlaybackAccess({
      mediaId: contentId,
      storageProvider: "local",
      storageKey: storageKey || "protected-provider-object",
      providerAssetId: undefined,
      contentType: content.mime_type || undefined,
      contentLength: content.file_size_bytes || undefined,
      visibility,
      userId,
      expiresInSeconds,
      token,
      kind: resolvedKind,
      quality: selectedQuality || parsedQuality.quality,
    });

    if (!access?.playbackUrl) {
      throw new DeliveryFailedException("Protected playback URL was not generated");
    }

    logger.info(
      {
        userId,
        contentId,
        sessionId,
        sessionReused: !createdNewSession,
        storageProvider,
        playbackMode,
        correlationId,
      },
      "[Playback] Access granted"
    );

    return {
      mediaId: contentId,
      sessionId,
      playbackUrl: access.playbackUrl,
      playbackMode,
      expiresIn: expiresInSeconds,
      expiresAt: new Date(expiresAtEpochSeconds * 1000).toISOString(),
      qualities,
      selectedQuality,
      defaultQuality,
      contentType: access.contentType,
      contentLength: access.contentLength,
    };
  } catch (error) {
    if (createdNewSession) {
      await discardPlaybackSession(sessionId, userId, contentId).catch(() => undefined);
    }
    throw error;
  }
}
