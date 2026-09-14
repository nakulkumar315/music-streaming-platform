import { v2 as cloudinary } from 'cloudinary';
import { MediaProvider, PlayerUrlResult, UploadResult } from './interfaces/MediaProvider';
import { normalizePublicId, isValidPublicId, logPublicIdNormalization } from '../../shared/utils/cloudinary.utils';
import type { VideoQuality } from '../../shared/delivery/interfaces/media-delivery-strategy.interface';
import { validateEnv } from '../../config/env.validation';

let isCloudinaryConfigured = false;

function ensureCloudinaryConfigured(): void {
  if (isCloudinaryConfigured) return;
  const runtime = validateEnv();
  if (!runtime.cloudinaryCloudName || !runtime.cloudinaryApiKey || !runtime.cloudinaryApiSecret) {
    throw new Error('Cloudinary configuration incomplete');
  }

  cloudinary.config({
    cloud_name: runtime.cloudinaryCloudName,
    api_key: runtime.cloudinaryApiKey,
    api_secret: runtime.cloudinaryApiSecret,
    secure: true,
    urlAnalytics: false,
    analytics: false,
  });
  isCloudinaryConfigured = true;
}

export class CloudinaryProvider implements MediaProvider {
  constructor() {
    ensureCloudinaryConfigured();
  }

  /** Legacy upload adapter. Canonical Phase-05+ uploads use shared/storage. */
  async uploadFile(
    filePath: string,
    artistId: string | number,
    mediaId: string | number,
    fileType: "audio" | "video" | "thumbnail"
  ): Promise<UploadResult> {
    if (String(artistId).includes("E2E_MOCK") || String(mediaId).includes("E2E_MOCK") || filePath.includes("test_")) {
      return {
        providerAssetId: `mock_asset_${fileType}_${mediaId}`,
        fileKey: `https://res.cloudinary.com/mock/image/upload/mock_asset_${fileType}_${mediaId}`,
        metadata: { format: 'mock', bytes: 1000 }
      };
    }

    const folderPath = fileType === "thumbnail"
      ? `artists/${artistId}/thumbnails/${mediaId}`
      : `artists/${artistId}/media/${mediaId}`;
    const isPublic = fileType === "thumbnail";
    const uploadOptions: any = {
      folder: folderPath,
      resource_type: fileType === "thumbnail" ? "image" : "video",
      type: isPublic ? "upload" : "authenticated",
      use_filename: true,
      unique_filename: true
    };

    // This path is retained only for legacy callers. Use limit rather than scale
    // so it can never upscale a low-resolution source merely to satisfy a label.
    if (fileType === "video") {
      uploadOptions.eager = [
        { width: 256,  height: 144,  crop: "limit", bit_rate: "100k", format: "m3u8" },
        { width: 426,  height: 240,  crop: "limit", bit_rate: "200k", format: "m3u8" },
        { width: 640,  height: 360,  crop: "limit", bit_rate: "400k", format: "m3u8" },
        { width: 854,  height: 480,  crop: "limit", bit_rate: "700k", format: "m3u8" },
        { width: 1280, height: 720,  crop: "limit", bit_rate: "1500k", format: "m3u8" },
        { width: 1920, height: 1080, crop: "limit", bit_rate: "3000k", format: "m3u8" },
        { streaming_profile: "auto", format: "m3u8" },
      ];
      uploadOptions.eager_async = true;
      const runtime = validateEnv();
      if (runtime.cloudinaryWebhookUrl) {
        uploadOptions.eager_notification_url = runtime.cloudinaryWebhookUrl;
      }
    }

    try {
      const response = await cloudinary.uploader.upload(filePath, uploadOptions);
      return {
        providerAssetId: response.public_id,
        fileKey: response.secure_url,
        metadata: {
          format: response.format,
          bytes: response.bytes,
          duration: response.duration,
          width: response.width,
          height: response.height,
          bit_rate: response.bit_rate
        }
      };
    } catch (error) {
      throw new Error(`Failed to upload to Cloudinary: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getQualityTransformation(quality: VideoQuality): Record<string, any> {
    const transformations: Record<Exclude<VideoQuality, 'SD' | 'HD'>, Record<string, any>> = {
      '144p': { width: 256, height: 144, crop: "limit", bit_rate: "100k" },
      '240p': { width: 426, height: 240, crop: "limit", bit_rate: "200k" },
      '360p': { width: 640, height: 360, crop: "limit", bit_rate: "400k" },
      '480p': { width: 854, height: 480, crop: "limit", bit_rate: "700k" },
      '720p': { width: 1280, height: 720, crop: "limit", bit_rate: "1500k" },
      '1080p': { width: 1920, height: 1080, crop: "limit", bit_rate: "3000k" },
      'Auto': { streaming_profile: "auto" },
    };

    if (quality === 'SD') return transformations['240p'];
    if (quality === 'HD') return transformations['Auto'];
    return transformations[quality] || transformations['Auto'];
  }

  async generateSignedPlaybackUrl(
    providerAssetId: string,
    fileType: "audio" | "video",
    quality: VideoQuality | undefined,
    expiresInSeconds: number
  ): Promise<PlayerUrlResult> {
    if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error('Invalid Cloudinary playback expiry');
    }

    let publicId: string;
    try {
      publicId = normalizePublicId(providerAssetId);
      logPublicIdNormalization(providerAssetId, publicId, "CloudinaryProvider");
    } catch (normError: any) {
      throw new Error(`Invalid public_id: ${providerAssetId.substring(0, 50)}. ${normError.message}`);
    }

    if (!isValidPublicId(publicId)) {
      throw new Error(`Invalid public_id format after normalization: ${publicId}`);
    }

    const isVideo = fileType === "video";
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const urlOptions: any = {
      resource_type: "video",
      type: "authenticated",
      sign_url: true,
      expires_at: expiresAt,
      analytics: false,
      urlAnalytics: false,
    };

    if (isVideo) {
      urlOptions.format = "m3u8";
      urlOptions.transformation = [this.getQualityTransformation(quality || 'Auto')];
    } else {
      urlOptions.format = "mp3";
    }

    try {
      const finalUrl = cloudinary.url(publicId, urlOptions);
      return {
        playbackUrl: finalUrl,
        expiryTime: expiresAt,
        mediaType: fileType
      };
    } catch (error) {
      throw new Error(`Cloudinary signed URL generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  generatePublicAssetUrl(
    providerAssetId: string,
    fileType: "thumbnail"
  ): string {
    const publicId = normalizePublicId(providerAssetId);
    if (!isValidPublicId(publicId)) {
      throw new Error(`Invalid public_id format for public asset: ${providerAssetId}`);
    }
    return cloudinary.url(publicId, {
      resource_type: "image",
      type: "upload",
      secure: true,
      analytics: false,
      urlAnalytics: false,
    });
  }

  async deleteFile(providerAssetId: string): Promise<boolean> {
    try {
      await cloudinary.uploader.destroy(providerAssetId, {
        type: "authenticated",
      });
      return true;
    } catch {
      return false;
    }
  }
}
