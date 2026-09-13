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
  MediaNotFoundException,
  MediaNotReadyException,
} from "../../shared/exceptions/media.exception";
import { resolveMediaIdentity } from "../../shared/media/media-asset-locator";
import {
  checkMediaEntitlement,
  getContentForAccess,
  validateQualityAccess,
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
import type { PlaybackAccessResponse } from "./media.types";

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

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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

  const quality = await validateQualityAccess(userId, input.quality);
  const config = getMediaConfig();
  const expiresInSeconds = Math.max(30, Math.min(config.mediaUrlTtlSeconds, 300));

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
      quality: quality.quality,
    });

    if (!access?.playbackUrl) {
      throw new DeliveryFailedException("Protected playback URL was not generated");
    }

    // Issuing or refreshing a signed access URL is not proof that playback
    // actually started. Phase 08 counts a play only after server-bounded forward
    // progress is observed on this lease's trusted heartbeat path.
    logger.info(
      {
        userId,
        contentId,
        sessionId,
        sessionReused: !createdNewSession,
        storageProvider,
        correlationId,
      },
      "[Playback] Access granted"
    );

    return {
      mediaId: contentId,
      sessionId,
      playbackUrl: access.playbackUrl,
      expiresIn: access.expiresIn,
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
