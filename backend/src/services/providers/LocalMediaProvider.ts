import { MediaProvider, PlayerUrlResult, UploadResult } from './interfaces/MediaProvider';
import type { VideoQuality } from '../../shared/delivery/interfaces/media-delivery-strategy.interface';
import path from 'path';
import fs from 'fs/promises';

export class LocalMediaProvider implements MediaProvider {
  /**
   * Mock local upload logic. Simply moves the file to the local uploads directory.
   */
  async uploadFile(
    filePath: string,
    artistId: string | number,
    mediaId: string | number,
    fileType: "audio" | "video" | "thumbnail"
  ): Promise<UploadResult> {
    
    // Naming strategy
    const folderPath = fileType === "thumbnail" 
      ? `artists/${artistId}/thumbnails` 
      : `artists/${artistId}/media`;
      
    // Create the directory structurally inside public/uploads
    const absoluteDirPath = path.join(process.cwd(), 'public', 'uploads', folderPath);
    await fs.mkdir(absoluteDirPath, { recursive: true }).catch(() => {});

    // Move file
    const newFileName = `${mediaId}-${path.basename(filePath)}`;
    const newFilePath = path.join(absoluteDirPath, newFileName);
    
    await fs.copyFile(filePath, newFilePath);
    
    // The relative public URL to access it locally on Express
    const localUrl = `/uploads/${folderPath}/${newFileName}`;

    console.log(`[LocalMediaProvider] Uploaded ${fileType} to ${localUrl}`);

    return {
      providerAssetId: newFilePath,
      fileKey: localUrl,
      metadata: {
        note: "Simulated local upload. Real metadata unavailable."
      }
    };
  }

  /**
   * Generates a basic signed-like string just resolving to the local URL directly since we have no local CDN signed url generation.
   */
  async generatePlaybackUrlLocal(
    filePath: string,
    fileType: "audio" | "video"
  ): Promise<PlayerUrlResult> {
    const expiresAt = Math.floor(Date.now() / 1000) + (5 * 60);

    const relativeUrl = filePath.split('public')[1] || filePath; // Extract URL part
    
    // Simulate a signed local streaming route or simply direct access
    // This assumes the frontend appends localhost:8000
    const localPlaybackUrl = relativeUrl;

    return {
      playbackUrl: localPlaybackUrl,
      expiryTime: expiresAt,
      mediaType: fileType
    };
  }
  
  async generateSignedPlaybackUrl(
    providerAssetId: string,
    fileType: "audio" | "video",
    quality?: VideoQuality,
    expiresInSeconds?: number
  ): Promise<PlayerUrlResult> {
      return this.generatePlaybackUrlLocal(providerAssetId, fileType);
  }

  /**
   * Delete locally
   */
  async deleteFile(providerAssetId: string): Promise<boolean> {
    try {
      await fs.unlink(providerAssetId);
      console.log(`[LocalMediaProvider] Deleted ${providerAssetId}`);
      return true;
    } catch (error) {
      console.error("[LocalMediaProvider] delete failed:", error);
      return false;
    }
  }
}
