/**
 * Shared types for storage layer. Provider-neutral.
 */

import { Readable } from "stream";

export type StorageProviderName = "local" | "firebase" | "s3" | "cloudinary";

export interface UploadObjectParams {
  storageKey: string;
  body: Buffer | Readable;
  contentType: string;
  /** Known source size allows streaming providers to avoid buffering. */
  contentLength?: number;
  metadata?: Record<string, string>;
}

export interface UploadObjectResult {
  storageKey: string;
  providerAssetId?: string;
  providerUrl?: string;
  etag?: string;
  sizeBytes?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  /** Planned adaptive variants. They are not playable until provider completion is verified. */
  adaptiveQualities?: string[];
}

export interface ObjectMetadata {
  storageKey: string;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
}

export interface OpenReadStreamParams {
  storageKey: string;
  start?: number;
  end?: number;
}

export interface OpenReadStreamResult {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
  acceptRanges?: boolean;
}

export interface GetPublicObjectUrlParams {
  providerAssetId: string;
  mediaType: "thumbnail";
}
