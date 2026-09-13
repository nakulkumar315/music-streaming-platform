import fs from "fs";
import os from "os";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { requireAuth, requireVerifiedArtist } from "../../common/auth/requireAuth";
import { uploadLimiter } from "../../common/security/rateLimit";
import { getMediaConfig } from "../../config/media.config";
import { getStorageConfig } from "../../config/storage.config";
import { validateSpooledFile, UploadValidationError } from "../content/media-upload-validation";
import { getExtensionFromMime } from "../../shared/storage/utils/file-metadata.util";
import { generateStorageKey } from "../../shared/storage/utils/storage-key.util";
import { getStorageService } from "../../shared/storage/services/storage.service";
import { getStorageProviderByName } from "../../shared/storage/factory/storage-provider.factory";
import type { StorageProviderName } from "../../shared/storage/interfaces/storage-types.interface";

const uploadRouter = Router();
const publicRouter = Router();
const spoolDir = path.join(os.tmpdir(), "music-streaming-artist-asset-spool");
fs.mkdirSync(spoolDir, { recursive: true });

const maxImageBytes = getMediaConfig().maxUploadImageBytes;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, spoolDir),
    filename: (_req, _file, cb) =>
      cb(null, `artist-image-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`),
  }),
  limits: { fileSize: maxImageBytes, files: 1, fields: 4 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    const allowed = mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
    cb(allowed ? null : (new Error("Unsupported image type") as any), allowed);
  },
});

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function assetKind(value: unknown): "PROFILE" | "BANNER" | null {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "PROFILE" || normalized === "BANNER" ? normalized : null;
}

function correlationUuid(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function stableAssetUrl(artistId: number, kind: "PROFILE" | "BANNER") {
  return `/api/v1/artist/assets/${artistId}/${kind.toLowerCase()}`;
}

const parseImage = (req: any, res: any, next: any) => {
  upload.single("image")(req, res, (error: any) => {
    if (!error) return next();
    const correlationId = req?.correlationId || "-";
    if (error instanceof multer.MulterError) {
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        success: false,
        code: error.code,
        message: error.code === "LIMIT_FILE_SIZE" ? "Image exceeds configured size limit" : "Invalid image upload",
        correlationId,
      });
    }
    return res.status(400).json({
      success: false,
      code: "UNSUPPORTED_IMAGE_TYPE",
      message: "Only JPEG, PNG and WebP images are supported",
      correlationId,
    });
  });
};

uploadRouter.post(
  "/image",
  uploadLimiter,
  requireAuth,
  requireVerifiedArtist,
  parseImage,
  async (req: any, res: any) => {
    const correlationId = req?.correlationId || "-";
    const artistId = positiveInteger(req.user?.id);
    const kind = assetKind(req.body?.kind);
    const file = req.file as Express.Multer.File | undefined;
    const storage = getStorageService();
    let uploaded: { storageKey: string; providerAssetId?: string } | null = null;

    try {
      if (!artistId) return res.status(401).json({ success: false, message: "Unauthorized", correlationId });
      if (!kind) {
        return res.status(400).json({
          success: false,
          message: "kind must be profile or banner",
          correlationId,
        });
      }
      if (!file?.path) {
        return res.status(400).json({ success: false, message: "image file is required", correlationId });
      }

      await validateSpooledFile({
        path: file.path,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        maxSizeBytes: maxImageBytes,
        kind: "thumbnail",
      });

      const extension = getExtensionFromMime(file.mimetype) || "jpg";
      const storageKey = generateStorageKey(artistId, "images", extension);
      const provider = getStorageConfig().provider;
      const result = await storage.upload({
        storageKey,
        body: fs.createReadStream(file.path),
        contentType: file.mimetype,
        contentLength: file.size,
        metadata: { artistId: String(artistId), assetKind: kind },
      });
      uploaded = { storageKey, providerAssetId: result.providerAssetId };

      const client = await pool.connect();
      let previous: any = null;
      try {
        await client.query("BEGIN");
        const old = await client.query(
          `SELECT storage_provider, storage_key, provider_asset_id
             FROM user_media_assets
            WHERE user_id = $1 AND kind = $2
            LIMIT 1
            FOR UPDATE`,
          [artistId, kind]
        );
        previous = old.rows[0] ?? null;

        await client.query(
          `INSERT INTO user_media_assets (
             user_id, kind, storage_provider, storage_key, provider_asset_id,
             mime_type, size_bytes, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
           ON CONFLICT (user_id, kind)
           DO UPDATE SET
             storage_provider = EXCLUDED.storage_provider,
             storage_key = EXCLUDED.storage_key,
             provider_asset_id = EXCLUDED.provider_asset_id,
             mime_type = EXCLUDED.mime_type,
             size_bytes = EXCLUDED.size_bytes,
             updated_at = now()`,
          [
            artistId,
            kind,
            provider,
            storageKey,
            result.providerAssetId || null,
            file.mimetype,
            file.size,
          ]
        );

        const column = kind === "PROFILE" ? "profile_image_url" : "banner_image_url";
        await client.query(
          `UPDATE users SET ${column} = $2, updated_at = now() WHERE id = $1`,
          [artistId, stableAssetUrl(artistId, kind)]
        );

        await client.query(
          `INSERT INTO audit_logs (
             id, action, entity, entity_id, actor_id, actor_role, status,
             correlation_id, metadata, created_at
           ) VALUES (
             gen_random_uuid(), 'artist.public_asset_updated', 'user', $1,
             $2, 'ARTIST', 'success', $3, $4, now()
           )`,
          [
            String(artistId),
            artistId,
            correlationUuid(correlationId),
            { kind, storage_provider: provider },
          ]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      if (previous?.storage_key) {
        try {
          const oldStorage = getStorageProviderByName(previous.storage_provider as StorageProviderName);
          await oldStorage.delete(previous.storage_key, previous.provider_asset_id || undefined);
        } catch (error) {
          logger.warn(
            { error, artistId, kind, previousProvider: previous.storage_provider },
            "[ArtistAsset] Previous asset cleanup failed"
          );
        }
      }

      return res.json({
        success: true,
        url: stableAssetUrl(artistId, kind),
        kind: kind.toLowerCase(),
        correlationId,
      });
    } catch (error: any) {
      if (uploaded) {
        await storage.delete(uploaded.storageKey, uploaded.providerAssetId).catch(() => undefined);
      }
      if (error instanceof UploadValidationError) {
        return res.status(400).json({
          success: false,
          code: error.code,
          message: error.message,
          correlationId,
        });
      }
      logger.error({ error, artistId, kind, correlationId }, "[ArtistAsset] Upload failed");
      return res.status(500).json({
        success: false,
        message: "Failed to upload image",
        correlationId,
      });
    } finally {
      if (file?.path) await fs.promises.unlink(file.path).catch(() => undefined);
    }
  }
);

publicRouter.get("/:artistId/:kind", async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const artistId = positiveInteger(req.params?.artistId);
  const kind = assetKind(req.params?.kind);
  if (!artistId || !kind) {
    return res.status(400).json({ success: false, message: "Invalid artist asset", correlationId });
  }

  try {
    const result = await pool.query(
      `SELECT a.storage_provider, a.storage_key, a.provider_asset_id, a.mime_type, a.size_bytes
         FROM user_media_assets a
         JOIN users u ON u.id = a.user_id
        WHERE a.user_id = $1
          AND a.kind = $2
          AND UPPER(u.role) = 'ARTIST'
          AND u.is_deleted = FALSE
          AND UPPER(u.status) = 'ACTIVE'
          AND u.is_verified = TRUE
          AND UPPER(u.artist_status::text) = 'APPROVED'
        LIMIT 1`,
      [artistId, kind]
    );
    const asset = result.rows[0];
    if (!asset) {
      return res.status(404).json({ success: false, message: "Image not found", correlationId });
    }

    const storage = getStorageProviderByName(asset.storage_provider as StorageProviderName);
    if (asset.provider_asset_id && storage.getPublicObjectUrl) {
      const url = await storage.getPublicObjectUrl({
        providerAssetId: String(asset.provider_asset_id),
        mediaType: "thumbnail",
      });
      if (url) {
        res.setHeader("Cache-Control", "public, max-age=300");
        return res.redirect(302, url);
      }
    }

    if (!storage.openReadStream) {
      return res.status(404).json({ success: false, message: "Image delivery unavailable", correlationId });
    }
    const read = await storage.openReadStream({ storageKey: String(asset.storage_key) });
    res.setHeader("Content-Type", String(asset.mime_type || read.contentType || "application/octet-stream"));
    const size = Number(asset.size_bytes || read.contentLength);
    if (Number.isFinite(size) && size > 0) res.setHeader("Content-Length", String(size));
    res.setHeader("Cache-Control", "public, max-age=300");
    read.stream.once("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    return read.stream.pipe(res);
  } catch (error) {
    logger.error({ error, artistId, kind, correlationId }, "[ArtistAsset] Delivery failed");
    return res.status(502).json({ success: false, message: "Failed to load image", correlationId });
  }
});

export { uploadRouter as artistAssetUploadRouter, publicRouter as artistPublicAssetRouter };
