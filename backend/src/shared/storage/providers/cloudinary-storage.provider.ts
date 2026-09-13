/**
 * Canonical Cloudinary storage adapter.
 *
 * Protected audio/video are uploaded as authenticated Cloudinary assets.
 * Artwork is intentionally public. The adapter streams the supplied body
 * directly to Cloudinary and never introduces production test bypasses.
 */

import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";
import type { IStorageProvider } from "../interfaces/storage-provider.interface";
import type {
  UploadObjectParams,
  UploadObjectResult,
  ObjectMetadata,
  OpenReadStreamParams,
  OpenReadStreamResult,
  GetPublicObjectUrlParams,
} from "../interfaces/storage-types.interface";
import { StorageProviderNotConfiguredException } from "../../exceptions/storage.exception";
import { normalizePublicId, isValidPublicId } from "../../utils/cloudinary.utils";

function requiredEnv(key: string): string {
  const value = String(process.env[key] || "").trim();
  if (!value) throw new StorageProviderNotConfiguredException(`cloudinary (missing: ${key})`);
  return value;
}

function providerIdFromStorageKey(storageKey: string): string {
  const normalized = String(storageKey || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\.[^/.]+$/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid Cloudinary storage key");
  }
  return normalized;
}

function inferKind(contentType: string | undefined, storageKey: string): "audio" | "video" | "thumbnail" {
  const mime = String(contentType || "").toLowerCase();
  if (mime.startsWith("image/")) return "thumbnail";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";

  const key = storageKey.toLowerCase();
  if (key.includes("/thumbnail") || key.includes("/artwork")) return "thumbnail";
  if (key.includes("/audio/")) return "audio";
  if (key.includes("/video/")) return "video";
  throw new Error("Unable to determine Cloudinary media type");
}

function optionsFor(kind: "audio" | "video" | "thumbnail", publicId: string) {
  const isThumbnail = kind === "thumbnail";
  const options: Record<string, unknown> = {
    public_id: publicId,
    resource_type: isThumbnail ? "image" : "video",
    type: isThumbnail ? "upload" : "authenticated",
    overwrite: false,
    unique_filename: false,
    use_filename: false,
  };

  if (kind === "video") {
    options.eager = [
      { width: 256, height: 144, crop: "scale", bit_rate: "100k", format: "m3u8" },
      { width: 426, height: 240, crop: "scale", bit_rate: "200k", format: "m3u8" },
      { width: 640, height: 360, crop: "scale", bit_rate: "400k", format: "m3u8" },
      { width: 854, height: 480, crop: "scale", bit_rate: "700k", format: "m3u8" },
      { width: 1280, height: 720, crop: "scale", bit_rate: "1500k", format: "m3u8" },
      { width: 1920, height: 1080, crop: "scale", bit_rate: "3000k", format: "m3u8" },
      { streaming_profile: "auto", format: "m3u8" },
    ];
    options.eager_async = true;
    const webhookUrl = String(process.env.CLOUDINARY_WEBHOOK_URL || "").trim();
    if (!webhookUrl) {
      throw new StorageProviderNotConfiguredException(
        "cloudinary (CLOUDINARY_WEBHOOK_URL is required for video processing)"
      );
    }
    options.eager_notification_url = webhookUrl;
  }

  return options;
}

export class CloudinaryStorageProvider implements IStorageProvider {
  constructor() {
    cloudinary.config({
      cloud_name: requiredEnv("CLOUDINARY_CLOUD_NAME"),
      api_key: requiredEnv("CLOUDINARY_API_KEY"),
      api_secret: requiredEnv("CLOUDINARY_API_SECRET"),
      secure: true,
      analytics: false,
      urlAnalytics: false,
    });
  }

  async upload(params: UploadObjectParams): Promise<UploadObjectResult> {
    const publicId = providerIdFromStorageKey(params.storageKey);
    const kind = inferKind(params.contentType, params.storageKey);
    const options = optionsFor(kind, publicId);

    return new Promise<UploadObjectResult>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(options, (error: any, result: any) => {
        if (error) return reject(error);
        if (!result?.public_id) return reject(new Error("Cloudinary upload returned no public_id"));

        resolve({
          storageKey: params.storageKey,
          providerAssetId: String(result.public_id),
          providerUrl: kind === "thumbnail" ? String(result.secure_url || "") || undefined : undefined,
          etag: result.etag ? String(result.etag) : undefined,
          sizeBytes: Number.isFinite(Number(result.bytes)) ? Number(result.bytes) : undefined,
        });
      });

      if (Buffer.isBuffer(params.body)) {
        uploadStream.end(params.body);
      } else {
        (params.body as Readable).on("error", reject).pipe(uploadStream);
      }
    });
  }

  async delete(storageKey: string, providerAssetId?: string): Promise<void> {
    const publicId = providerAssetId || providerIdFromStorageKey(storageKey);
    const kind = inferKind(undefined, storageKey);
    await cloudinary.uploader.destroy(publicId, {
      resource_type: kind === "thumbnail" ? "image" : "video",
      type: kind === "thumbnail" ? "upload" : "authenticated",
      invalidate: true,
    });
  }

  async exists(storageKey: string, providerAssetId?: string): Promise<boolean> {
    const publicId = providerAssetId || providerIdFromStorageKey(storageKey);
    const kind = inferKind(undefined, storageKey);
    try {
      await cloudinary.api.resource(publicId, {
        resource_type: kind === "thumbnail" ? "image" : "video",
        type: kind === "thumbnail" ? "upload" : "authenticated",
      });
      return true;
    } catch (error: any) {
      if (Number(error?.http_code || error?.statusCode) === 404) return false;
      throw error;
    }
  }

  async getObjectMetadata(
    storageKey: string,
    providerAssetId?: string
  ): Promise<ObjectMetadata | null> {
    const publicId = providerAssetId || providerIdFromStorageKey(storageKey);
    const kind = inferKind(undefined, storageKey);
    try {
      const result: any = await cloudinary.api.resource(publicId, {
        resource_type: kind === "thumbnail" ? "image" : "video",
        type: kind === "thumbnail" ? "upload" : "authenticated",
      });
      return {
        storageKey,
        contentType: result?.format ? `${kind === "thumbnail" ? "image" : kind}/${result.format}` : undefined,
        contentLength: Number.isFinite(Number(result?.bytes)) ? Number(result.bytes) : undefined,
        etag: result?.etag ? String(result.etag) : undefined,
        lastModified: result?.created_at ? new Date(result.created_at) : undefined,
      };
    } catch (error: any) {
      if (Number(error?.http_code || error?.statusCode) === 404) return null;
      throw error;
    }
  }

  async openReadStream(_params: OpenReadStreamParams): Promise<OpenReadStreamResult> {
    throw new Error("Cloudinary uses signed delivery URLs; openReadStream is not supported");
  }

  async getPublicObjectUrl(params: GetPublicObjectUrlParams): Promise<string | null> {
    if (params.mediaType !== "thumbnail" || !params.providerAssetId) return null;
    const publicId = normalizePublicId(params.providerAssetId);
    if (!isValidPublicId(publicId)) return null;
    return cloudinary.url(publicId, {
      resource_type: "image",
      type: "upload",
      secure: true,
      analytics: false,
      urlAnalytics: false,
    });
  }
}
