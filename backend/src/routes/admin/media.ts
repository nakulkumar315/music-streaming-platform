import fs from "fs";
import os from "os";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { uploadLimiter } from "../../common/security/rateLimit";
import { getMediaConfig } from "../../config/media.config";
import { uploadAdminMedia } from "../../controllers/admin/adminMediaController";

const router = Router();
const spoolDir = path.join(os.tmpdir(), "music-streaming-upload-spool");
fs.mkdirSync(spoolDir, { recursive: true });

const mediaConfig = getMediaConfig();
const maxFileSize = Math.max(
  mediaConfig.maxUploadAudioBytes,
  mediaConfig.maxUploadVideoBytes,
  mediaConfig.maxUploadImageBytes
);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, spoolDir),
    filename: (_req, file, cb) => {
      const safeField = file.fieldname === "thumbnail" ? "thumbnail" : "media";
      cb(null, `${safeField}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
    },
  }),
  limits: {
    fileSize: maxFileSize,
    files: 2,
    // Phase 09 adds bounded optional release metadata to the existing admin
    // upload form. Keep the parser bounded while allowing the full supported
    // field set without silently rejecting legitimate requests.
    fields: 24,
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    const declaredAllowed =
      file.fieldname === "thumbnail"
        ? mime === "image/jpeg" || mime === "image/png" || mime === "image/webp"
        : file.fieldname === "media" &&
          (mime.startsWith("audio/") || mime === "video/mp4" || mime === "video/quicktime");
    if (!declaredAllowed) {
      cb(new Error("Unsupported upload media type"));
      return;
    }
    cb(null, true);
  },
});

const parseUpload = (req: any, res: any, next: any) => {
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "media", maxCount: 1 },
  ])(req, res, (error: any) => {
    if (!error) return next();

    const correlationId = req?.correlationId || "-";
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({
        success: false,
        code: error.code,
        message: error.code === "LIMIT_FILE_SIZE" ? "Upload exceeds configured size limit" : "Invalid upload payload",
        correlationId,
      });
    }
    return res.status(400).json({
      success: false,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Unsupported upload media type",
      correlationId,
    });
  });
};

router.post("/upload", uploadLimiter, parseUpload, uploadAdminMedia);

export default router;
