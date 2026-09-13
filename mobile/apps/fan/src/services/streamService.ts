/**
 * Requests short-lived playback URLs from the canonical backend MediaAccessService.
 * The client never decides entitlement or preview permission.
 */

import Constants from 'expo-constants';
import { APP_ENV, isAllowedPlaybackUrl } from '../config/env';
import { apiV1, normalizeApiError } from './api';

export type StreamAccessResponse = {
  success: boolean;
  mediaId?: number;
  sessionId?: number;
  playbackUrl?: string;
  expiresIn?: number;
  contentType?: string;
  contentLength?: number;
  message?: string;
  code?: string;
};

export type PlaybackAccess = {
  mediaId: number;
  sessionId: number;
  playbackUrl: string;
  expiresIn?: number;
  contentType?: string;
  contentLength?: number;
};

export type ActivePlaybackLease = {
  contentId: number;
  sessionId: number;
};

let activePlaybackLease: ActivePlaybackLease | null = null;

export class StreamAccessError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(message: string, code = 'STREAM_ACCESS_FAILED', status: number | null = null) {
    super(message);
    this.name = 'StreamAccessError';
    this.code = code;
    this.status = status;
  }
}

export type PlaybackErrorPresentation = {
  title: string;
  message: string;
  retryable: boolean;
  shouldStopPlayback: boolean;
};

/**
 * Converts backend machine codes into deterministic user-safe playback UX.
 * Do not parse backend message strings here; those are diagnostic text and may
 * change independently of the public API contract.
 */
export function getPlaybackErrorPresentation(error: unknown): PlaybackErrorPresentation {
  const code = error instanceof StreamAccessError ? error.code : 'STREAM_ACCESS_FAILED';

  switch (code) {
    case 'AUTHENTICATION_REQUIRED':
    case 'UNAUTHORIZED':
      return {
        title: 'Sign in required',
        message: 'Your session is no longer active. Please sign in again to continue playback.',
        retryable: false,
        shouldStopPlayback: true,
      };
    case 'SUBSCRIPTION_REQUIRED':
      return {
        title: 'Subscription required',
        message: 'This release requires an active subscription to the artist.',
        retryable: false,
        shouldStopPlayback: true,
      };
    case 'SUBSCRIPTION_EXPIRED':
      return {
        title: 'Subscription expired',
        message: 'Your artist subscription has expired. Renew it to continue playback.',
        retryable: false,
        shouldStopPlayback: true,
      };
    case 'SUBSCRIPTION_INACTIVE':
      return {
        title: 'Subscription unavailable',
        message: 'Your artist subscription is not active. Check your subscription before trying again.',
        retryable: false,
        shouldStopPlayback: true,
      };
    case 'CONTENT_TAKEN_DOWN':
      return {
        title: 'Content unavailable',
        message: 'This content is no longer available for playback.',
        retryable: false,
        shouldStopPlayback: true,
      };
    case 'CONTENT_NOT_READY':
      return {
        title: 'Content not ready',
        message: 'This content is still being prepared. Please try again later.',
        retryable: true,
        shouldStopPlayback: true,
      };
    case 'PLAYBACK_SESSION_LIMIT':
      return {
        title: 'Playback limit reached',
        message: 'Too many playback sessions are active. Close another stream and try again.',
        retryable: true,
        shouldStopPlayback: false,
      };
    case 'PLAYBACK_SESSION_EXPIRED':
    case 'PLAYBACK_SESSION_MISMATCH':
    case 'PLAYBACK_ACCESS_EXPIRED':
    case 'INVALID_PLAYBACK_TOKEN':
      return {
        title: 'Playback session expired',
        message: 'Playback access expired. Please start playback again to create a fresh session.',
        retryable: true,
        shouldStopPlayback: true,
      };
    case 'CONTENT_NOT_FOUND':
      return {
        title: 'Content unavailable',
        message: 'This content could not be found or is no longer available.',
        retryable: false,
        shouldStopPlayback: true,
      };
    case 'DELIVERY_PROVIDER_UNAVAILABLE':
    case 'PLAYBACK_URL_GENERATION_FAILED':
      return {
        title: 'Playback temporarily unavailable',
        message: 'The media service is temporarily unavailable. Please try again shortly.',
        retryable: true,
        shouldStopPlayback: false,
      };
    case 'INVALID_PLAYBACK_URL':
      return {
        title: 'Playback unavailable',
        message: 'The server returned an invalid playback source. Please try again later.',
        retryable: false,
        shouldStopPlayback: true,
      };
    default:
      return {
        title: 'Playback error',
        message: 'Could not start playback. Please try again.',
        retryable: true,
        shouldStopPlayback: false,
      };
  }
}

function getDevHost(): string | null {
  const hostUri =
    (Constants.expoConfig as any)?.hostUri ??
    (Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost ??
    (Constants as any)?.manifest?.debuggerHost ??
    null;

  if (!hostUri || typeof hostUri !== 'string') return null;
  return hostUri.split(':')[0] || null;
}

export function normalizePlaybackUrl(url: string): string {
  if (!url) return url;

  // Localhost rewriting is a development-only convenience. Preview and
  // production bundles must consume the exact HTTPS URL issued by the server.
  if (APP_ENV !== 'development' && APP_ENV !== 'test') return url;

  if (!/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/i.test(url)) return url;
  const host = getDevHost();
  if (!host) return url;
  return url.replace(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/i, (match) => {
    const portMatch = match.match(/:(\d+)$/);
    const port = portMatch ? `:${portMatch[1]}` : '';
    const scheme = url.startsWith('https://') ? 'https://' : 'http://';
    return `${scheme}${host}${port}`;
  });
}

export function validatePlaybackUrl(url: string, kind?: 'audio' | 'video'): boolean {
  if (!url || !isAllowedPlaybackUrl(url)) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const lowerPath = parsed.pathname.toLowerCase();
  const kindParam = String(parsed.searchParams.get('kind') || '').toLowerCase();
  const token = parsed.searchParams.get('token');
  const isTokenizedPrivateStream = lowerPath.includes('/media/stream/');
  if (isTokenizedPrivateStream) {
    if (!token) return false;
    if (!kind) return true;
    return kindParam === kind;
  }

  if (kind === 'video') {
    return lowerPath.endsWith('.m3u8') || lowerPath.endsWith('.mp4') || lowerPath.includes('/video/');
  }

  if (kind === 'audio') {
    return (
      lowerPath.endsWith('.mp3') ||
      lowerPath.endsWith('.m4a') ||
      lowerPath.endsWith('.aac') ||
      lowerPath.endsWith('.wav') ||
      // Cloudinary commonly delivers audio assets through its /video/ resource path.
      lowerPath.includes('/video/')
    );
  }

  return true;
}

export type VideoQuality = '144p' | '240p' | '360p' | '480p' | '720p' | '1080p' | 'Auto' | 'SD' | 'HD';

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function getActivePlaybackLease(
  contentId?: string | number
): ActivePlaybackLease | null {
  if (!activePlaybackLease) return null;
  if (contentId === undefined) return { ...activePlaybackLease };
  const validContentId = positiveInteger(contentId);
  if (!validContentId || validContentId !== activePlaybackLease.contentId) return null;
  return { ...activePlaybackLease };
}

function clearActivePlaybackLease(expectedSessionId?: number) {
  if (
    expectedSessionId === undefined ||
    activePlaybackLease?.sessionId === expectedSessionId
  ) {
    activePlaybackLease = null;
  }
}

/**
 * Requests initial playback access or refreshes the short-lived token for one
 * existing server playback lease. A refresh must return the same session id;
 * otherwise the client fails closed rather than silently consuming a new slot.
 */
export async function getPlaybackAccess(
  contentId: string | number,
  kind?: 'audio' | 'video',
  quality?: VideoQuality,
  existingSessionId?: number
): Promise<PlaybackAccess> {
  try {
    const numericContentId = positiveInteger(contentId);
    if (!numericContentId) {
      throw new StreamAccessError('Invalid content id', 'INVALID_CONTENT_ID', null);
    }

    const sessionId =
      existingSessionId === undefined ? undefined : positiveInteger(existingSessionId);
    if (existingSessionId !== undefined && !sessionId) {
      throw new StreamAccessError(
        'Playback session is invalid',
        'PLAYBACK_SESSION_EXPIRED',
        null
      );
    }

    const res = await apiV1.post<StreamAccessResponse>('/stream/access', {
      contentId: numericContentId,
      sessionId,
      kind,
      quality,
    });
    const data = res.data;
    const returnedSessionId = positiveInteger(data?.sessionId);
    if (!data?.success || !data?.playbackUrl || !returnedSessionId) {
      throw new StreamAccessError(
        data?.message || 'Failed to get playback URL',
        data?.code || 'STREAM_ACCESS_FAILED',
        res.status
      );
    }

    if (sessionId && returnedSessionId !== sessionId) {
      throw new StreamAccessError(
        'Playback session changed unexpectedly',
        'PLAYBACK_SESSION_MISMATCH',
        res.status
      );
    }

    const normalized = normalizePlaybackUrl(data.playbackUrl);
    if (!validatePlaybackUrl(normalized, kind)) {
      throw new StreamAccessError(
        'Received an invalid playback URL',
        'INVALID_PLAYBACK_URL',
        res.status
      );
    }

    return {
      mediaId: positiveInteger(data.mediaId) || numericContentId,
      sessionId: returnedSessionId,
      playbackUrl: normalized,
      expiresIn: data.expiresIn,
      contentType: data.contentType,
      contentLength: data.contentLength,
    };
  } catch (error) {
    if (error instanceof StreamAccessError) throw error;
    const normalized = normalizeApiError(error);
    throw new StreamAccessError(normalized.message, normalized.code, normalized.status);
  }
}

/** Best-effort explicit release of one server playback lease. */
export async function terminatePlaybackAccess(
  sessionId: number,
  contentId: string | number
): Promise<boolean> {
  const validSessionId = positiveInteger(sessionId);
  const validContentId = positiveInteger(contentId);
  if (!validSessionId || !validContentId) return false;

  try {
    const response = await apiV1.post('/stream/terminate', {
      sessionId: validSessionId,
      contentId: validContentId,
    });
    return response.data?.success === true && response.data?.terminated === true;
  } catch {
    // Session release is best effort on close/switch. Server staleness cleanup
    // remains the final safety net; callers should clear local lease state.
    return false;
  }
}

export async function releaseActivePlaybackLease(): Promise<boolean> {
  const lease = activePlaybackLease;
  if (!lease) return true;

  // Clear first so an overlapping new playback request cannot accidentally
  // reuse a lease the user has already chosen to release.
  clearActivePlaybackLease(lease.sessionId);
  return terminatePlaybackAccess(lease.sessionId, lease.contentId);
}

/**
 * Explicitly replace an expired same-content server lease. This is used only
 * after the backend has rejected the old heartbeat/session as expired. The
 * fresh access request re-checks account/content/subscription authorization and
 * concurrency before a new lease is accepted locally.
 *
 * The returned signed URL is intentionally not persisted. Native playback may
 * already have an open/buffered source; this command repairs the control-plane
 * authorization lease so subsequent trusted heartbeats are bound to a current
 * server session. Normal player URL refresh paths still apply fresh URLs when
 * the source itself needs renewal.
 */
export async function reacquireExpiredPlaybackLease(
  contentId: string | number
): Promise<ActivePlaybackLease> {
  const numericContentId = positiveInteger(contentId);
  if (!numericContentId) {
    throw new StreamAccessError('Invalid content id', 'INVALID_CONTENT_ID', null);
  }

  const stale = getActivePlaybackLease(numericContentId);
  if (stale) {
    clearActivePlaybackLease(stale.sessionId);
    await terminatePlaybackAccess(stale.sessionId, stale.contentId);
  }

  const access = await getPlaybackAccess(numericContentId);
  activePlaybackLease = {
    contentId: numericContentId,
    sessionId: access.sessionId,
  };
  return { ...activePlaybackLease };
}

/**
 * Managed URL helper used by the single global mobile player. Repeated calls
 * for the same content are token refreshes and reuse one server lease. A call
 * for different content releases the old lease before allocating a new one.
 */
export async function getPlaybackUrl(
  contentId: string | number,
  kind?: 'audio' | 'video',
  quality?: VideoQuality
): Promise<string> {
  const numericContentId = positiveInteger(contentId);
  if (!numericContentId) {
    throw new StreamAccessError('Invalid content id', 'INVALID_CONTENT_ID', null);
  }

  if (activePlaybackLease && activePlaybackLease.contentId !== numericContentId) {
    await releaseActivePlaybackLease();
  }

  const existing = getActivePlaybackLease(numericContentId);
  try {
    const access = await getPlaybackAccess(
      numericContentId,
      kind,
      quality,
      existing?.sessionId
    );
    activePlaybackLease = {
      contentId: numericContentId,
      sessionId: access.sessionId,
    };
    return access.playbackUrl;
  } catch (error) {
    if (
      error instanceof StreamAccessError &&
      (error.code === 'PLAYBACK_SESSION_EXPIRED' ||
        error.code === 'PLAYBACK_SESSION_MISMATCH')
    ) {
      clearActivePlaybackLease(existing?.sessionId);
    }
    throw error;
  }
}