import fs from "fs";
import type { Response } from "express";
import { pool } from "../../common/db";
import { getStorageConfig } from "../../config/storage.config";
import { getMediaConfig } from "../../config/media.config";
import { getStorageService } from "../../shared/storage/services/storage.service";
import { generateStorageKey } from "../../shared/storage/utils/storage-key.util";
import { getExtensionFromMime } from "../../shared/storage/utils/file-metadata.util";
import {
  UploadValidationError,
  validateSpooledFile,
  validateUploadMetadata,
} from "../../modules/content/media-upload-validation";
import { validatePhase1ReleaseMetadata } from "../../modules/distribution/release-domain.validation";
import {
  ensureSingleReleaseForAudioContent,
  type ReleaseCompatibilityResult,
} from "../../modules/distribution/release-compatibility.service";

function correlationUuid(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function sendError(res: Response, error: unknown, correlationId: string) {
  if (error instanceof UploadValidationError) {
    return res.status(400).json({
      success: false,
      code: error.code,
      message: error.message,
      correlationId,
    });
  }
  return res.status(500).json({
    success: false,
    code: "MEDIA_UPLOAD_FAILED",
    message: "Media upload failed",
    correlationId,
  });
}

async function assertGovernableArtist(artistId: number) {
  const result = await pool.query(
    `SELECT id, role, status, is_deleted, artist_status, is_verified
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [artistId]
  );
  const artist = result.rows[0];
  if (!artist) throw new UploadValidationError("ARTIST_NOT_FOUND", "Artist not found");
  if (
    String(artist.role || "").toUpperCase() !== "ARTIST" ||
    String(artist.status || "").toUpperCase() !== "ACTIVE" ||
    Boolean(artist.is_deleted) ||
    String(artist.artist_status || "").toUpperCase() !== "APPROVED" ||
    !Boolean(artist.is_verified)
  ) {
    throw new UploadValidationError(
      "ARTIST_NOT_GOVERNABLE",
      "Artist must be active, approved and verified before content upload"
    );
  }
}

async function compensate(
  storage: ReturnType<typeof getStorageService>,
  uploaded: Array<{ storageKey: string; providerAssetId?: string }>
) {
  for (const item of [...uploaded].reverse()) {
    await storage.delete(item.storageKey, item.providerAssetId).catch(() => undefined);
  }
}

export async function uploadAdminMedia(req: any, res: Response) {
  const correlationId = req?.correlationId || "-";
  const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
  const thumbnail = files.thumbnail?.[0];
  const media = files.media?.[0];
  const storage = getStorageService();
  const uploaded: Array<{ storageKey: string; providerAssetId?: string }> = [];
  let contentId: number | null = null;
  let releaseMapping: ReleaseCompatibilityResult | null = null;

  try {
    if (!thumbnail || !media) {
      throw new UploadValidationError(
        "UPLOAD_FILES_REQUIRED",
        "thumbnail and media files are required"
      );
    }

    const metadata = validateUploadMetadata({
      artistId: req.body?.artistId,
      title: req.body?.title,
      genre: req.body?.genre,
      contentType: req.body?.contentType,
      subscriptionRequired: req.body?.subscriptionRequired,
    });
    const releaseMetadata = validatePhase1ReleaseMetadata(
      (req.body ?? {}) as Record<string, unknown>,
      metadata.contentType
    );
    await assertGovernableArtist(metadata.artistId);

    const mediaConfig = getMediaConfig();
    const expectedKind = metadata.contentType === "VIDEO" ? "video" : "audio";
    await validateSpooledFile({
      path: thumbnail.path,
      mimeType: thumbnail.mimetype,
      sizeBytes: thumbnail.size,
      maxSizeBytes: mediaConfig.maxUploadImageBytes,
      kind: "thumbnail",
    });
    await validateSpooledFile({
      path: media.path,
      mimeType: media.mimetype,
      sizeBytes: media.size,
      maxSizeBytes:
        metadata.contentType === "VIDEO"
          ? mediaConfig.maxUploadVideoBytes
          : mediaConfig.maxUploadAudioBytes,
      kind: expectedKind,
    });

    const thumbnailExt = getExtensionFromMime(thumbnail.mimetype) || "jpg";
    const mediaExt =
      getExtensionFromMime(media.mimetype) || (metadata.contentType === "VIDEO" ? "mp4" : "mp3");
    const thumbnailKey = generateStorageKey(metadata.artistId, "thumbnails", thumbnailExt);
    const mediaKey = generateStorageKey(
      metadata.artistId,
      metadata.contentType === "VIDEO" ? "video" : "audio",
      mediaExt
    );
    const storageProvider = getStorageConfig().provider;

    const inserted = await pool.query(
      `INSERT INTO content_items (
         title, type, artist_id, genre,
         lifecycle_state, is_approved, is_taken_down, rejection_reason,
         status, subscription_required, visibility, storage_provider,
         storage_key, video_storage_key, thumbnail_storage_key,
         mime_type, file_size_bytes, original_file_name, uploaded_at
       ) VALUES (
         $1, $2, $3, $4,
         'DRAFT', FALSE, FALSE, NULL,
         'UPLOADING', $5, 'PROTECTED', $6,
         $7, $8, $9,
         $10, $11, $12, NULL
       )
       RETURNING id`,
      [
        metadata.title,
        metadata.contentType,
        metadata.artistId,
        metadata.genre,
        metadata.subscriptionRequired,
        storageProvider,
        metadata.contentType === "AUDIO" ? mediaKey : null,
        metadata.contentType === "VIDEO" ? mediaKey : null,
        thumbnailKey,
        media.mimetype,
        media.size,
        media.originalname,
      ]
    );
    contentId = Number(inserted.rows[0].id);

    const thumbnailUpload = await storage.upload({
      storageKey: thumbnailKey,
      body: fs.createReadStream(thumbnail.path),
      contentType: thumbnail.mimetype,
      contentLength: thumbnail.size,
      metadata: { contentId: String(contentId), artistId: String(metadata.artistId) },
    });
    uploaded.push({ storageKey: thumbnailKey, providerAssetId: thumbnailUpload.providerAssetId });

    const mediaUpload = await storage.upload({
      storageKey: mediaKey,
      body: fs.createReadStream(media.path),
      contentType: media.mimetype,
      contentLength: media.size,
      metadata: { contentId: String(contentId), artistId: String(metadata.artistId) },
    });
    uploaded.push({ storageKey: mediaKey, providerAssetId: mediaUpload.providerAssetId });

    const technicalStatus =
      storageProvider === "cloudinary" && metadata.contentType === "VIDEO"
        ? "PROCESSING"
        : "READY";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE content_items
            SET status = $2,
                provider_asset_id = $3,
                audio_provider_asset_id = $4,
                video_provider_asset_id = $5,
                thumbnail_provider_asset_id = $6,
                thumbnail_url = $7,
                media_url = NULL,
                audio_url = NULL,
                video_url = NULL,
                file_key = NULL,
                uploaded_at = now()
          WHERE id = $1`,
        [
          contentId,
          technicalStatus,
          mediaUpload.providerAssetId || null,
          metadata.contentType === "AUDIO" ? mediaUpload.providerAssetId || null : null,
          metadata.contentType === "VIDEO" ? mediaUpload.providerAssetId || null : null,
          thumbnailUpload.providerAssetId || null,
          thumbnailUpload.providerUrl || null,
        ]
      );

      if (metadata.contentType === "AUDIO" && releaseMetadata) {
        releaseMapping = await ensureSingleReleaseForAudioContent(client, {
          contentId,
          artistId: metadata.artistId,
          title: metadata.title,
          genre: metadata.genre,
          thumbnailStorageKey: thumbnailKey,
          thumbnailProviderAssetId: thumbnailUpload.providerAssetId || null,
          metadata: releaseMetadata,
        });
      }

      await client.query(
        `INSERT INTO audit_logs (
           id, action, entity, entity_id, actor_id, actor_role, status,
           correlation_id, metadata, created_at
         ) VALUES (
           gen_random_uuid(), 'content.uploaded', 'content', $1, $2, 'ADMIN', 'success', $3, $4, now()
         )`,
        [
          String(contentId),
          Number(req.user?.id),
          correlationUuid(correlationId),
          {
            artist_id: metadata.artistId,
            lifecycle_state: "DRAFT",
            technical_status: technicalStatus,
            storage_provider: storageProvider,
            ...(releaseMapping
              ? {
                  release_id: releaseMapping.releaseId,
                  release_track_id: releaseMapping.releaseTrackId,
                  distribution_status: "NOT_SUBMITTED",
                }
              : {}),
          },
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    return res.status(201).json({
      success: true,
      content: {
        id: contentId,
        artistId: metadata.artistId,
        title: metadata.title,
        type: metadata.contentType,
        lifecycleState: "DRAFT",
        technicalStatus,
        isApproved: false,
        isTakenDown: false,
        ...(releaseMapping
          ? {
              releaseId: releaseMapping.releaseId,
              releaseTrackId: releaseMapping.releaseTrackId,
              distributionStatus: "NOT_SUBMITTED",
            }
          : {}),
      },
      correlationId,
    });
  } catch (error) {
    if (uploaded.length) await compensate(storage, uploaded);
    if (contentId) {
      await pool
        .query(
          `UPDATE content_items
              SET status = 'FAILED',
                  provider_asset_id = NULL,
                  audio_provider_asset_id = NULL,
                  video_provider_asset_id = NULL,
                  thumbnail_provider_asset_id = NULL,
                  thumbnail_url = NULL
            WHERE id = $1`,
          [contentId]
        )
        .catch(() => undefined);
    }
    return sendError(res, error, correlationId);
  } finally {
    for (const file of [thumbnail, media]) {
      if (file?.path) await fs.promises.unlink(file.path).catch(() => undefined);
    }
  }
}
