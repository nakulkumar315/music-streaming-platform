import { apiV1, normalizeApiError } from './api';
import { getActivePlaybackLease } from './streamService';

export type PlaybackProgress = {
  contentId: number;
  positionMs: number;
  durationMs: number | null;
  completed: boolean;
  updatedAt: string;
};

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
 * Persists UX resume state only while the global player owns an active server
 * playback lease. This is intentionally separate from heartbeat/play counts.
 */
export async function savePlaybackProgress(input: {
  contentId: string | number;
  positionMs: number;
  durationMs?: number | null;
}): Promise<PlaybackProgress | null> {
  const numericContentId = positiveInteger(input.contentId);
  if (!numericContentId) return null;

  const lease = getActivePlaybackLease(numericContentId);
  if (!lease) return null;

  try {
    const response = await apiV1.put('/playback-progress', {
      contentId: numericContentId,
      sessionId: lease.sessionId,
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
      normalized.code === 'PLAYBACK_SESSION_EXPIRED' ||
      normalized.code === 'SUBSCRIPTION_REQUIRED' ||
      normalized.code === 'SUBSCRIPTION_EXPIRED' ||
      normalized.code === 'CONTENT_TAKEN_DOWN'
    ) {
      return null;
    }
    throw error;
  }
}
