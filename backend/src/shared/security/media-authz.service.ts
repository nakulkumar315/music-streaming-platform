/**
 * Canonical media authorization for fan playback.
 *
 * This module deliberately contains no schema fallbacks or development
 * bypasses. A database/schema failure must fail the request rather than make
 * protected content public.
 */

import { pool } from "../../common/db";
import { hasActiveArtistEntitlement } from "./artist-entitlement.service";

export type VisibilityType = "PUBLIC" | "PROTECTED" | "PRIVATE_INTERNAL";

export interface MediaAccessCheckResult {
  allowed: boolean;
  reason?: string;
  tier?: "FREE" | "ARTIST";
}

export type VideoQuality =
  | "144p"
  | "240p"
  | "360p"
  | "480p"
  | "720p"
  | "1080p"
  | "Auto";

const VALID_QUALITIES: VideoQuality[] = [
  "144p",
  "240p",
  "360p",
  "480p",
  "720p",
  "1080p",
  "Auto",
];

export async function validateQualityAccess(
  _userId: number | null,
  requestedQuality?: string
): Promise<{
  authorized: boolean;
  quality: VideoQuality;
  maxAllowedQuality: VideoQuality;
}> {
  const raw = String(requestedQuality || "Auto").trim().toLowerCase();
  if (raw === "sd") {
    return { authorized: true, quality: "480p", maxAllowedQuality: "1080p" };
  }
  if (raw === "hd") {
    return { authorized: true, quality: "Auto", maxAllowedQuality: "1080p" };
  }

  const quality =
    VALID_QUALITIES.find((candidate) => candidate.toLowerCase() === raw) ?? "Auto";
  return { authorized: true, quality, maxAllowedQuality: "1080p" };
}

export async function checkMediaEntitlement(
  userId: number | null,
  artistId: number,
  visibility: VisibilityType,
  subscriptionRequired: boolean
): Promise<MediaAccessCheckResult> {
  if (!userId) {
    return { allowed: false, reason: "Authentication required", tier: "FREE" };
  }

  if (visibility === "PRIVATE_INTERNAL") {
    return { allowed: false, reason: "Content is internal only", tier: "FREE" };
  }

  if (subscriptionRequired) {
    const entitled = await hasActiveArtistEntitlement(userId, artistId);
    return entitled
      ? { allowed: true, tier: "ARTIST" }
      : { allowed: false, reason: "Active artist subscription required", tier: "FREE" };
  }

  if (visibility === "PUBLIC" || visibility === "PROTECTED") {
    return { allowed: true, tier: "FREE" };
  }

  return { allowed: false, reason: "Unknown visibility", tier: "FREE" };
}

export interface ContentForAccess {
  id: number;
  artist_id: number;
  storage_provider: string | null;
  storage_key: string | null;
  video_storage_key: string | null;
  thumbnail_storage_key: string | null;
  provider_asset_id: string | null;
  audio_provider_asset_id: string | null;
  video_provider_asset_id: string | null;
  thumbnail_provider_asset_id: string | null;
  visibility: string;
  status: string;
  lifecycle_state: string;
  is_approved: boolean;
  is_taken_down: boolean;
  subscription_required: boolean;
  mime_type: string | null;
  file_size_bytes: number | null;
  media_url: string | null;
  audio_url: string | null;
  video_url: string | null;
  type: string | null;
  file_key: string | null;
  thumbnail_url: string | null;
}

/**
 * Load the exact current content authorization/delivery record. Artist account
 * governance is part of the access boundary, not merely a catalog filter.
 */
export async function getContentForAccess(
  contentId: number
): Promise<ContentForAccess | null> {
  const result = await pool.query<ContentForAccess>(
    `SELECT c.id,
            c.artist_id,
            c.storage_provider,
            c.storage_key,
            c.video_storage_key,
            c.thumbnail_storage_key,
            c.provider_asset_id,
            c.audio_provider_asset_id,
            c.video_provider_asset_id,
            c.thumbnail_provider_asset_id,
            c.visibility,
            c.status,
            c.lifecycle_state,
            c.is_approved,
            c.is_taken_down,
            c.subscription_required,
            c.mime_type,
            c.file_size_bytes,
            c.media_url,
            c.audio_url,
            c.video_url,
            c.type,
            c.file_key,
            c.thumbnail_url
       FROM content_items c
       JOIN users a ON a.id = c.artist_id
      WHERE c.id = $1
        AND UPPER(a.role) = 'ARTIST'
        AND a.is_deleted = FALSE
        AND UPPER(a.status) = 'ACTIVE'
        AND a.is_verified = TRUE
        AND UPPER(a.artist_status::text) = 'APPROVED'
      LIMIT 1`,
    [contentId]
  );

  return result.rows[0] ?? null;
}
