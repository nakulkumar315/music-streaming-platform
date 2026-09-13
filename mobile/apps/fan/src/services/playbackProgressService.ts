import { apiV1, normalizeApiError } from './api';

export type PlaybackProgress = {
  contentId: number;
  positionMs: number;
  durationMs: number | null;
  completed: boolean;
  updatedAt: string;
};

const MIN_RESUME_POSITION_MS = 3_000;
const COMPLETION_RATIO = 0.95;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Converts persisted UX progress into a safe resume target. Completion and
 * near-end positions intentionally restart from the beginning. The media URL
 * itself is never persisted/reused; playback still requests fresh access.
 */
export function resolveResumePosition(
  progress: PlaybackProgress | null,
  currentDurationMs?: number | null
): number {
  if (!progress || progress.completed) return 0;

  const savedPosition = Math.max(0, Math.floor(Number(progress.positionMs) || 0));
  if (savedPosition < MIN_RESUME_POSITION_MS) return 0;

  const knownDuration = Math.max(
    0,
    Math.floor(Number(currentDurationMs ?? progress.durationMs ?? 0) || 0)
  );
  if (knownDuration > 0 && savedPosition >= Math.floor(knownDuration * COMPLETION_RATIO)) {
    return 0;
  }

  return knownDuration > 0 ? Math.min(savedPosition, knownDuration) : savedPosition;
}

export async function fetchPlaybackProgress(
  contentId: string | number
): Promise<PlaybackProgress | null> {
  const numericContentId = positiveInteger(contentId);
  if (!numericContentId) return null;

  const response = await apiV1.get(`/playback-progress/${numericContentId}`);
  const progress = response.data?.progress;
  if (!response.data?.success || !progress) return null;

  return {
    contentId: numericContentId,
    positionMs: Math.max(0, Math.floor(Number(progress.positionMs) || 0)),
    durationMs:
      progress.durationMs === null || progress.durationMs === undefined
        ? null
        : Math.max(0, Math.floor(Number(progress.durationMs) || 0)),
    completed: Boolean(progress.completed),
    updatedAt: String(progress.updatedAt || ''),
  };
}

/**
 * Persists authenticated UX resume state. This API is deliberately separate
 * from heartbeat and content-play analytics and therefore does not require a
 * short-lived playback lease. Backend entitlement is rechecked on every write.
 */
export async function savePlaybackProgress(input: {
  contentId: string | number;
  positionMs: number;
  durationMs?: number | null;
}): Promise<PlaybackProgress | null> {
  const numericContentId = positiveInteger(input.contentId);
  if (!numericContentId) return null;

  try {
    const response = await apiV1.put('/playback-progress', {
      contentId: numericContentId,
      positionMs: Math.max(0, Math.floor(Number(input.positionMs) || 0)),
      durationMs:
        input.durationMs === null || input.durationMs === undefined
          ? null
          : Math.max(0, Math.floor(Number(input.durationMs) || 0)),
    });
    return response.data?.success ? (response.data.progress as PlaybackProgress) : null;
  } catch (error) {
    const normalized = normalizeApiError(error);
    if (
      normalized.code === 'SUBSCRIPTION_REQUIRED' ||
      normalized.code === 'SUBSCRIPTION_EXPIRED' ||
      normalized.code === 'SUBSCRIPTION_INACTIVE' ||
      normalized.code === 'CONTENT_TAKEN_DOWN' ||
      normalized.code === 'CONTENT_NOT_READY' ||
      normalized.code === 'CONTENT_NOT_FOUND'
    ) {
      return null;
    }
    throw error;
  }
}
