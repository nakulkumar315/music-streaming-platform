import { apiV1 } from './api';
import { isAllowedPlaybackUrl } from '../config/env';

const FALLBACK_IMAGE = require('../logo.png');

export type GuestArtist = {
  id: string;
  name: string;
  image: any;
  subscriberCount: string;
  isVerified: boolean;
};

export type GuestAudioTrack = {
  id: string;
  title: string;
  artistName: string;
  artwork: any;
  duration?: string;
  badge?: 'EARLY_ACCESS' | 'PREMIUM' | 'NEW';
};

export type GuestExclusiveContent = {
  id: string;
  title: string;
  artistName: string;
  artwork: any;
  badge: 'EARLY_ACCESS' | 'PREMIUM' | 'NEW';
};

export type GuestMusicVideo = {
  id: string;
  title: string;
  artistName: string;
  thumbnail: any;
  duration?: string;
  viewCount: string;
};

export type GuestHomeData = {
  artists: GuestArtist[];
  tracks: GuestAudioTrack[];
  locked: GuestExclusiveContent[];
  videos: GuestMusicVideo[];
};

function imageSource(raw: unknown) {
  const value = String(raw || '').trim();
  return value && isAllowedPlaybackUrl(value) ? { uri: value } : FALLBACK_IMAGE;
}

function compactCount(raw: unknown): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return '0 views';
  if (value < 1_000) return `${Math.floor(value)} views`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K views`;
  return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M views`;
}

function uniqueDerivedArtists(items: any[]): GuestArtist[] {
  const seen = new Set<string>();
  const artists: GuestArtist[] = [];

  for (const item of items) {
    const id = String(item?.artistId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    artists.push({
      id,
      name: String(item?.artistName || 'Artist'),
      image: imageSource(item?.thumbnailUrl || item?.artwork),
      subscriberCount: 'Artist on MusicWave',
      isVerified: true,
    });
    if (artists.length >= 10) break;
  }

  return artists;
}

export async function loadGuestHomeData(): Promise<GuestHomeData> {
  const [contentResponse, featuredResponse] = await Promise.all([
    apiV1.get('/content', { params: { limit: 30 } }),
    apiV1.get('/artists/featured', { params: { limit: 10 } }),
  ]);

  const items = Array.isArray(contentResponse.data?.items) ? contentResponse.data.items : [];
  const featured = Array.isArray(featuredResponse.data?.artists) ? featuredResponse.data.artists : [];

  const artists: GuestArtist[] = featured.map((artist: any) => ({
    id: String(artist?.id ?? ''),
    name: String(artist?.name || 'Artist'),
    image: imageSource(artist?.avatar || artist?.profileImageUrl),
    subscriberCount: 'Featured artist',
    isVerified: true,
  })).filter((artist: GuestArtist) => Boolean(artist.id));

  const tracks: GuestAudioTrack[] = [];
  const locked: GuestExclusiveContent[] = [];
  const videos: GuestMusicVideo[] = [];

  for (const item of items) {
    const id = String(item?.id ?? '').trim();
    if (!id) continue;

    const title = String(item?.title || 'Untitled');
    const artistName = String(item?.artistName || 'Artist');
    const artwork = imageSource(item?.thumbnailUrl || item?.artwork);
    const mediaType = String(item?.mediaType || item?.type || '').toLowerCase();
    const isLocked = item?.isLocked === true || item?.subscriptionRequired === true;

    if (isLocked) {
      locked.push({
        id,
        title,
        artistName,
        artwork,
        badge: 'EARLY_ACCESS',
      });
      continue;
    }

    if (mediaType === 'video') {
      videos.push({
        id,
        title,
        artistName,
        thumbnail: artwork,
        viewCount: compactCount(item?.viewCount),
      });
      continue;
    }

    tracks.push({
      id,
      title,
      artistName,
      artwork,
      badge: String(item?.lifecycleState || '').toUpperCase() === 'EARLY_ACCESS' ? 'EARLY_ACCESS' : undefined,
    });
  }

  return {
    artists: artists.length ? artists : uniqueDerivedArtists(items),
    tracks: tracks.slice(0, 12),
    locked: locked.slice(0, 12),
    videos: videos.slice(0, 12),
  };
}
