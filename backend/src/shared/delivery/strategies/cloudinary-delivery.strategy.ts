/**
 * Cloudinary delivery strategy. Section 22.3.
 * Generates signed playback URLs for Cloudinary media.
 *
 * IMPORTANT: providerAssetId must be a valid Cloudinary public_id, NOT a full URL.
 */

import type { IMediaDeliveryStrategy, VideoQuality } from "../interfaces/media-delivery-strategy.interface";
import type { GeneratePlaybackAccessParams, PlaybackAccessResult } from "../interfaces/media-delivery-strategy.interface";
import { DeliveryFailedException } from "../../exceptions/delivery.exception";
import { normalizePublicId, isValidPublicId, logPublicIdNormalization } from "../../utils/cloudinary.utils";

interface CloudinaryPlaybackSigner {
  generateSignedPlaybackUrl(
    providerAssetId: string,
    fileType: "audio" | "video",
    quality: VideoQuality | undefined,
    expiresInSeconds: number
  ): Promise<{ playbackUrl: string }>;
}

export class CloudinaryDeliveryStrategy implements IMediaDeliveryStrategy {
  constructor(private readonly provider?: CloudinaryPlaybackSigner) {}

  async generatePlaybackAccess(params: GeneratePlaybackAccessParams): Promise<PlaybackAccessResult> {
    const { providerAssetId, contentType, contentLength, expiresInSeconds, kind } = params;

    try {
      if (!providerAssetId) {
        throw new DeliveryFailedException("Cloudinary providerAssetId is required");
      }
      if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
        throw new DeliveryFailedException("Cloudinary playback expiry is invalid");
      }

      let publicId: string;
      try {
        publicId = normalizePublicId(providerAssetId);
        logPublicIdNormalization(providerAssetId, publicId, "cloudinary-delivery");
      } catch (normError: any) {
        throw new DeliveryFailedException(`Invalid provider asset identity: ${normError.message}`);
      }

      if (!isValidPublicId(publicId)) {
        throw new DeliveryFailedException("Invalid public_id format after normalization");
      }

      const fileType: "audio" | "video" = kind || (contentType?.startsWith("audio/") ? "audio" : "video");
      let signer = this.provider;
      if (!signer) {
        const cloudinaryModule = await import("../../../services/providers/CloudinaryProvider");
        signer = new cloudinaryModule.CloudinaryProvider();
      }

      const result = await signer.generateSignedPlaybackUrl(
        publicId,
        fileType,
        params.quality,
        expiresInSeconds
      );

      return {
        playbackUrl: result.playbackUrl,
        expiresIn: expiresInSeconds,
        contentType,
        contentLength,
      };
    } catch (err: any) {
      throw new DeliveryFailedException(err?.message || "Cloudinary signed URL generation failed");
    }
  }
}
