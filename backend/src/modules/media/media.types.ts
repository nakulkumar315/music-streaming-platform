/**
 * Media module types.
 */

import type { Visibility, MediaStatus } from "./media.constants";
import type { VideoQuality } from "../../shared/security/media-authz.service";

export interface MediaRecord {
  id: number;
  artistId: number;
  mediaType: string;
  title: string;
  description?: string | null;
  storageProvider: string;
  storageKey: string;
  visibility: Visibility;
  status: MediaStatus;
  isApproved: boolean;
  originalFileName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  durationSeconds?: number | null;
  thumbnailStorageKey?: string | null;
  isEarlyAccess?: boolean;
  subscriptionRequired: boolean;
  createdAt: Date;
  updatedAt?: Date;
  uploadedAt?: Date | null;
}

export type PlaybackMode = "HLS" | "PROGRESSIVE";

export interface PlaybackAccessResponse {
  mediaId: number;
  sessionId: number;
  playbackUrl: string;
  playbackMode: PlaybackMode;
  expiresIn: number;
  expiresAt: string;
  qualities: VideoQuality[];
  selectedQuality?: VideoQuality;
  defaultQuality: VideoQuality | "ORIGINAL";
  contentType?: string;
  contentLength?: number;
}
