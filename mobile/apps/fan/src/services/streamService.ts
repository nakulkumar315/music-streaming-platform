/**
 * Requests short-lived playback descriptors from the canonical backend
 * MediaAccessService. The client never decides entitlement or preview permission.
 */

import Constants from 'expo-constants';
import { APP_ENV, isAllowedPlaybackUrl } from '../config/env';
import { apiV1, normalizeApiError } from './api';

export type VideoQuality = '144p' | '240p' | '360p' | '480p' | '720p' | '1080p' | 'Auto' | 'SD' | 'HD';
export type CanonicalVideoQuality = Exclude<VideoQuality, 'SD' | 'HD'>;
export type PlaybackMode = 'HLS' | 'PROGRESSIVE';

export type StreamAccessResponse = {
  success: boolean;
  mediaId?: number;
  sessionId?: number;
  playbackUrl?: string;
  playbackMode?: PlaybackMode;
  expiresIn?: number;
  expiresAt?: string;
  qualities?: CanonicalVideoQuality[];
  selectedQuality?: CanonicalVideoQuality;
  defaultQuality?: CanonicalVideoQuality | 'ORIGINAL';
  contentType?: string;
  contentLength?: number;
  message?: string;
  code?: string;
};

export type PlaybackAccess = {
  mediaId: number;
  sessionId: number;
  playbackUrl: string;
  playbackMode: PlaybackMode;
  expiresIn: number;
  expiresAt: string;
  qualities: CanonicalVideoQuality[];
  selectedQuality?: CanonicalVideoQuality;
  defaultQuality: CanonicalVideoQuality | 'ORIGINAL';
  contentType?: string;
  contentLength?: number;
};

export type ActivePlaybackLease = {
  contentId: number;
  sessionId: number;
  lastValidatedAtMs: number;
};

const ACTIVE_LEASE_LOCAL_FRESHNESS_MS = 4 * 60 * 1000;
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
    case 'INVALID_PLAYBACK_QUALITY':
      return {
        title: 'Quality unavailable',
        message: 'That quality is not available for this video. Choose one of the available options.',
        retryable: false,
        shouldStopPlayback: false,
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
    case 'INVALID_PLAYBACK_DESCRIPTOR':
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
  const resource = parsed.searchParams.get('resource');
  const isTokenizedPrivateStream = lowerPath.includes('/media/stream/');
  if (isTokenizedPrivateStream) {
    if (!token && !resource) return false;
    if (resource) return true;
    if (!kind) return true;
    return kindParam === kind;
  }

  // Phase 09A closes the protected-video fail-open path. The player must never
  // accept a raw provider/CDN video URL from catalog or legacy navigation data;
  // only the backend-protected stream/HLS boundary above is authoritative.
  if (kind === 'video') return false;

  if (kind === 'audio') {
    return (
      lowerPath.endsWith('.mp3') ||
      lowerPath.endsWith('.m4a') ||
      lowerPath.endsWith('.aac') ||
      lowerPath.endsWith('.wav') ||
      lowerPath.includes('/video/')
    );
  }

  return true;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function storeActiveLease(contentId: number, sessionId: number): ActivePlaybackLease {
  activePlaybackLease = {
    contentId,
    sessionId,
    lastValidatedAtMs: Date.now(),
  };
  return { ...activePlaybackLease };
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

export function markActivePlaybackLeaseAlive(sessionId: number): void {
  const validSessionId = positiveInteger(sessionId);
  if (!validSessionId || activePlaybackLease?.sessionId !== validSessionId) return;
  activePlaybackLease = {
    ...activePlaybackLease,
    lastValidatedAtMs: Date.now(),
  };
}

function clearActivePlaybackLease(expectedSessionId?: number) {
  if (
    expectedSessionId === undefined ||
    activePlaybackLease?.sessionId === expectedSessionId
  ) {
    activePlaybackLease = null;
  }
}

function parseDescriptor(
  data: StreamAccessResponse,
  numericContentId: number,
  returnedSessionId: number,
  kind?: 'audio' | 'video',
  status?: number
): PlaybackAccess {
  const normalized = normalizePlaybackUrl(String(data.playbackUrl || ''));
  if (!validatePlaybackUrl(normalized, kind)) {
    throw new StreamAccessError('Received an invalid playback URL', 'INVALID_PLAYBACK_URL', status ?? null);
  }

  const playbackMode = data.playbackMode;
  const expiresIn = Number(data.expiresIn);
  const expiresAt = String(data.expiresAt || '');
  const expiryMs = Date.parse(expiresAt);
  if (
    (playbackMode !== 'HLS' && playbackMode !== 'PROGRESSIVE') ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    !Number.isFinite(expiryMs) ||
    expiryMs <= Date.now()
  ) {
    throw new StreamAccessError('Invalid playback descriptor', 'INVALID_PLAYBACK_DESCRIPTOR', status ?? null);
  }

  const qualities = Array.isArray(data.qualities)
    ? data.qualities.filter((quality): quality is CanonicalVideoQuality =>
        ['144p', '240p', '360p', '480p', '720p', '1080p', 'Auto'].includes(String(quality)))
    : [];

  if (playbackMode === 'HLS' && kind === 'video' && qualities.length === 0) {
    throw new StreamAccessError('Adaptive playback has no verified qualities', 'INVALID_PLAYBACK_DESCRIPTOR', status ?? null);
  }

  return {
    mediaId: positiveInteger(data.mediaId) || numericContentId,
    sessionId: returnedSessionId,
    playbackUrl: normalized,
    playbackMode,
    expiresIn,
    expiresAt,
    qualities,
    selectedQuality: data.selectedQuality,
    defaultQuality: data.defaultQuality || 'ORIGINAL',
    contentType: data.contentType,
    contentLength: data.contentLength,
  };
}

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
      throw new StreamAccessError('Playback session is invalid', 'PLAYBACK_SESSION_EXPIRED', null);
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

    return parseDescriptor(data, numericContentId, returnedSessionId, kind, res.status);
  } catch (error) {
    if (error instanceof StreamAccessError) throw error;
    const normalized = normalizeApiError(error);
    throw new StreamAccessError(normalized.message, normalized.code, normalized.status);
  }
}

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
    return false;
  }
}

export async function releaseActivePlaybackLease(): Promise<boolean> {
  const lease = activePlaybackLease;
  if (!lease) return true;
  clearActivePlaybackLease(lease.sessionId);
  return terminatePlaybackAccess(lease.sessionId, lease.contentId);
}

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
  return storeActiveLease(numericContentId, access.sessionId);
}

export async function ensureActivePlaybackLease(
  contentId: string | number
): Promise<ActivePlaybackLease> {
  const numericContentId = positiveInteger(contentId);
  if (!numericContentId) {
    throw new StreamAccessError('Invalid content id', 'INVALID_CONTENT_ID', null);
  }

  if (activePlaybackLease && activePlaybackLease.contentId !== numericContentId) {
    await releaseActivePlaybackLease();
  }

  const existing = getActivePlaybackLease(numericContentId);
  if (
    existing &&
    Date.now() - existing.lastValidatedAtMs < ACTIVE_LEASE_LOCAL_FRESHNESS_MS
  ) {
    return existing;
  }

  if (existing) {
    try {
      const refreshed = await getPlaybackAccess(
        numericContentId,
        undefined,
        undefined,
        existing.sessionId
      );
      return storeActiveLease(numericContentId, refreshed.sessionId);
    } catch (error) {
      if (
        !(error instanceof StreamAccessError) ||
        (error.code !== 'PLAYBACK_SESSION_EXPIRED' &&
          error.code !== 'PLAYBACK_SESSION_MISMATCH')
      ) {
        throw error;
      }
      clearActivePlaybackLease(existing.sessionId);
    }
  }

  const created = await getPlaybackAccess(numericContentId);
  return storeActiveLease(numericContentId, created.sessionId);
}

export async function getPlaybackDescriptor(
  contentId: string | number,
  kind?: 'audio' | 'video',
  quality?: VideoQuality
): Promise<PlaybackAccess> {
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
    storeActiveLease(numericContentId, access.sessionId);
    return access;
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

export async function getPlaybackUrl(
  contentId: string | number,
  kind?: 'audio' | 'video',
  quality?: VideoQuality
): Promise<string> {
  const access = await getPlaybackDescriptor(contentId, kind, quality);
  return access.playbackUrl;
}
