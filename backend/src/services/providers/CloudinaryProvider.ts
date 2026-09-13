import { v2 as cloudinary } from 'cloudinary';
import { MediaProvider, PlayerUrlResult, UploadResult } from './interfaces/MediaProvider';
import { normalizePublicId, isValidPublicId, logPublicIdNormalization } from '../../shared/utils/cloudinary.utils';
import type { VideoQuality } from '../../shared/delivery/interfaces/media-delivery-strategy.interface';

let isCloudinaryConfigured = false;

function ensureCloudinaryConfigured(): void {
  if (isCloudinaryConfigured) return;
  const required = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Cloudinary configuration incomplete. Missing: ${missing.join(', ')}`);
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
    // Disable auto-appended analytics (?_a=...) token — it can confuse iOS AVPlayer
    // and is not needed for server-side URL generation.
    urlAnalytics: false,
    analytics: false,
  });

  console.log('[CloudinaryProvider] Configuration loaded successfully');
  isCloudinaryConfigured = true;
}

export class CloudinaryProvider implements MediaProvider {
  constructor() {
    ensureCloudinaryConfigured();
  }
  /**
   * Upload file to Cloudinary mapping logic to authenticated delivery except thumbnails
   */
  async uploadFile(
    filePath: string,
    artistId: string | number,
    mediaId: string | number,
    fileType: "audio" | "video" | "thumbnail"
  ): Promise<UploadResult> {
    
    // E2E Test Mock Bypass
    if (String(artistId).includes("E2E_MOCK") || String(mediaId).includes("E2E_MOCK") || filePath.includes("test_")) {
      console.log(`[CloudinaryProvider] MOCK UPLOAD for ${fileType} (mediaId: ${mediaId})`);
      return {
        providerAssetId: `mock_asset_${fileType}_${mediaId}`,
        fileKey: `https://res.cloudinary.com/mock/image/upload/mock_asset_${fileType}_${mediaId}`,
        metadata: { format: 'mock', bytes: 1000 }
      };
    }
    
    // Naming strategy: artists/{artistId}/media/{mediaId}
    const folderPath = fileType === "thumbnail" 
      ? `artists/${artistId}/thumbnails/${mediaId}` 
      : `artists/${artistId}/media/${mediaId}`;
      
    // Thumbnails are public, everything else is authenticated
    const isPublic = fileType === "thumbnail";
    const uploadOptions: any = {
      folder: folderPath,
      resource_type: fileType === "thumbnail" ? "image" : "video", // Cloudinary treats both audio and video as "video" mostly, or "auto"
      type: isPublic ? "upload" : "authenticated", // authenticated delivery
      use_filename: true,
      unique_filename: true
    };

    // If it's a video, trigger HLS eager transformations for the full quality
    // ladder: 144p → 240p → 360p → 480p → 720p → 1080p.
    // auto profile may prioritize higher renditions; we still generate lower
    // ladders explicitly to avoid quality option gaps.
    // 144p and 240p so those quality menu options don't 404.
    if (fileType === "video") {
      uploadOptions.eager = [
        // 144p — ~100 kbps
        { width: 256,  height: 144,  crop: "scale", bit_rate: "100k", format: "m3u8" },
        // 240p — ~200 kbps
        { width: 426,  height: 240,  crop: "scale", bit_rate: "200k", format: "m3u8" },
        // 360p — ~400 kbps
        { width: 640,  height: 360,  crop: "scale", bit_rate: "400k", format: "m3u8" },
        // 480p — ~700 kbps
        { width: 854,  height: 480,  crop: "scale", bit_rate: "700k", format: "m3u8" },
        // 720p HD — ~1500 kbps
        { width: 1280, height: 720,  crop: "scale", bit_rate: "1500k", format: "m3u8" },
        // 1080p Full HD — ~3000 kbps
        { width: 1920, height: 1080, crop: "scale", bit_rate: "3000k", format: "m3u8" },
        // Auto adaptive ABR master playlist
        { streaming_profile: "auto", format: "m3u8" },
      ];
      uploadOptions.eager_async = true;

      // Cloudinary needs an absolute URL to notify when eager transforms finish.
      if (process.env.CLOUDINARY_WEBHOOK_URL) {
        uploadOptions.eager_notification_url = process.env.CLOUDINARY_WEBHOOK_URL;
      }
    }

    try {
      const response = await cloudinary.uploader.upload(filePath, uploadOptions);
      
      return {
        providerAssetId: response.public_id,
        fileKey: response.secure_url, // For public thumbnails we can use secure_url, for authenticated this will be an authenticated origin URL
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
      console.error("Cloudinary upload failed:", error);
      throw new Error(`Failed to upload to Cloudinary: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Map specific video qualities to Cloudinary transformation parameters.
   * These match the eager transformations created during upload.
   */
  private getQualityTransformation(quality: VideoQuality): Record<string, any> {
    const transformations: Record<Exclude<VideoQuality, 'SD' | 'HD'>, Record<string, any>> = {
      '144p': { width: 256, height: 144, crop: "scale", bit_rate: "100k" },
      '240p': { width: 426, height: 240, crop: "scale", bit_rate: "200k" },
      '360p': { width: 640, height: 360, crop: "scale", bit_rate: "400k" },
      '480p': { width: 854, height: 480, crop: "scale", bit_rate: "700k" },
      '720p': { width: 1280, height: 720, crop: "scale", bit_rate: "1500k" },
      '1080p': { width: 1920, height: 1080, crop: "scale", bit_rate: "3000k" },
      'Auto': { streaming_profile: "auto" },
    };

    // Handle legacy values
    if (quality === 'SD') return transformations['240p'];
    if (quality === 'HD') return transformations['Auto'];
    
    return transformations[quality] || transformations['Auto'];
  }

  /**
   * Generates a signed, short-lived URL for authenticated delivery.
   * @param providerAssetId - The Cloudinary public_id (NOT a full URL)
   * @param fileType - 'audio' or 'video'
   */
  async generateSignedPlaybackUrl(
    providerAssetId: string,
    fileType: "audio" | "video",
    quality?: VideoQuality
  ): Promise<PlayerUrlResult> {
    
    // CRITICAL: Normalize providerAssetId to valid public_id
    // This removes file extensions (.mp3, .mp4) and version prefixes (v123/)
    let publicId: string;
    try {
      publicId = normalizePublicId(providerAssetId);
      logPublicIdNormalization(providerAssetId, publicId, "CloudinaryProvider");
    } catch (normError: any) {
      console.error(`[CloudinaryProvider] Failed to normalize public_id:`, normError.message);
      throw new Error(`Invalid public_id: ${providerAssetId.substring(0, 50)}. ${normError.message}`);
    }

    // Validate the normalized public_id
    if (!isValidPublicId(publicId)) {
      console.error(`[CloudinaryProvider] Invalid public_id after normalization: ${publicId}`);
      throw new Error(`Invalid public_id format after normalization: ${publicId}`);
    }
    
    console.log(`[CloudinaryProvider] Generating signed URL for public_id=${publicId}, type=${fileType}, quality=${quality || 'default'}`);
    
    // Determine the resource format needed
    const isVideo = fileType === "video";
    
    const expirySeconds = 5 * 60; // 5 minutes
    const expiresAt = Math.floor(Date.now() / 1000) + expirySeconds;

    const urlOptions: any = {
      resource_type: "video", // Cloudinary uses resource_type video for both audio and video
      type: "authenticated",
      sign_url: true,
      expires_at: expiresAt,
      // Prevent Cloudinary SDK from appending ?_a=... analytics token.
      // This token, added AFTER signing, can cause iOS AVPlayer / SwiftAudioEx
      // to reject the URL with AudioPlayerError.PlaybackError.
      analytics: false,
      urlAnalytics: false,
    };
    
    if (isVideo) {
      // For video, request HLS format with streaming profile
      urlOptions.format = "m3u8";
      
      // QUALITY SELECTION: Apply specific transformation based on requested quality.
      // Each quality generates a unique URL with different resolution/bitrate.
      const qualityTransform = this.getQualityTransformation(quality || 'Auto');
      urlOptions.transformation = [qualityTransform];
      
      console.log(`[CloudinaryProvider] Quality ${quality || 'Auto'} => transformation:`, qualityTransform);
    } else {
      // For audio, specify mp3 format for compatibility.
      // IMPORTANT: Do NOT apply bitrate or any other transformation here.
      // Authenticated Cloudinary resources cannot be lazily transcoded — the
      // transformation must have been pre-generated (eager) at upload time.
      // Adding a transformation to an authenticated audio URL that wasn't
      // eagerly generated returns a Cloudinary error, which causes iOS
      // SwiftAudioEx.AudioPlayerError.PlaybackError on the device.
      urlOptions.format = "mp3";
    }

    try {
      // cloudinary.url already includes format in the signed path.
      // Appending extensions manually can corrupt signed query params.
      const finalUrl = cloudinary.url(publicId, urlOptions);
      
      console.log(`[CloudinaryProvider] Generated signed URL for public_id=${publicId}`);
      
      return {
        playbackUrl: finalUrl,
        expiryTime: expiresAt,
        mediaType: fileType
      };
    } catch (error) {
      console.error(`[CloudinaryProvider] Failed to generate signed URL:`, error);
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

  /**
   * Delete securely
   */
  async deleteFile(providerAssetId: string): Promise<boolean> {
    try {
      // type="authenticated" is required to delete authenticated resources unless specified otherwise
      await cloudinary.uploader.destroy(providerAssetId, {
        type: "authenticated", // Might need to check if it's a public thumb, but we'll assume media here
      });
      return true;
    } catch (error) {
      console.error("Cloudinary delete failed:", error);
      return false;
    }
  }
}
