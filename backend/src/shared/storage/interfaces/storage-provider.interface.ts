/**
 * Storage provider contract. Section 7.
 * Only storage operations; no entitlement or playback decisions.
 */

import type {
  UploadObjectParams,
  UploadObjectResult,
  ObjectMetadata,
  OpenReadStreamParams,
  OpenReadStreamResult,
  GetPublicObjectUrlParams
} from "./storage-types.interface";

export interface IStorageProvider {
  upload(params: UploadObjectParams): Promise<UploadObjectResult>;
  /**
   * Delete one stored object. `providerAssetId` is optional because key-addressed
   * providers (local/S3/Firebase) only need the canonical storage key, while
   * Cloudinary deletion is safest with the exact provider asset id returned at
   * upload time.
   */
  delete(storageKey: string, providerAssetId?: string): Promise<void>;
  exists(storageKey: string, providerAssetId?: string): Promise<boolean>;
  getObjectMetadata(storageKey: string, providerAssetId?: string): Promise<ObjectMetadata | null>;
  openReadStream?(params: OpenReadStreamParams): Promise<OpenReadStreamResult>;
  getPublicObjectUrl?(params: GetPublicObjectUrlParams): Promise<string | null>;
}
