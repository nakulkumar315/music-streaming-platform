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

export async function getPlaybackUrl(
  contentId: string | number,
  kind?: 'audio' | 'video',
  quality?: VideoQuality
): Promise<string> {
  try {
    const res = await apiV1.post<StreamAccessResponse>('/stream/access', {
      contentId: Number(contentId),
      kind,
      quality,
    });
    const data = res.data;
    if (!data?.success || !data?.playbackUrl) {
      throw new StreamAccessError(
        data?.message || 'Failed to get playback URL',
        data?.code || 'STREAM_ACCESS_FAILED',
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
    return normalized;
  } catch (error) {
    if (error instanceof StreamAccessError) throw error;
    const normalized = normalizeApiError(error);
    throw new StreamAccessError(normalized.message, normalized.code, normalized.status);
  }
}
