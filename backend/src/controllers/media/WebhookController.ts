import type { Response } from "express";
import { pool } from "../../common/db";
import {
  hasSuccessfulAutoHlsResult,
  successfulHlsResultCount,
} from "../../modules/media/adaptive-renditions";
import {
  CloudinaryWebhookAuthError,
  deriveCloudinaryEventId,
  verifyCloudinaryWebhook,
} from "../../modules/media/cloudinary-webhook.security";

function parsePayload(rawBody: Buffer) {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return parsed as Record<string, any>;
  } catch {
    const error: any = new Error("Cloudinary webhook body is invalid JSON");
    error.statusCode = 400;
    error.code = "CLOUDINARY_WEBHOOK_BODY_INVALID";
    throw error;
  }
}

function eagerOutcome(body: Record<string, any>): "READY" | "FAILED" | null {
  const top = String(body.status || body.eager_status || "").trim().toLowerCase();
  const entries = Array.isArray(body.eager) ? body.eager : [];
  const statuses = entries
    .map((entry: any) => String(entry?.status || entry?.state || "").trim().toLowerCase())
    .filter(Boolean);

  if (top === "failed" || statuses.some((status: string) => status === "failed" || status === "error")) {
    return "FAILED";
  }
  if (["success", "succeeded", "complete", "completed", "ready"].includes(top)) {
    return "READY";
  }
  if (
    statuses.length > 0 &&
    statuses.every((status: string) => ["success", "succeeded", "complete", "completed"].includes(status))
  ) {
    return "READY";
  }
  return null;
}

export const handleMediaWebhook = async (req: any, res: Response) => {
  const correlationId = req?.correlationId || "-";
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  if (!rawBody) {
    return res.status(400).json({
      success: false,
      code: "CLOUDINARY_RAW_BODY_REQUIRED",
      message: "Cloudinary webhook requires the exact raw request body",
      correlationId,
    });
  }

  const signature = String(req.headers["x-cld-signature"] || "").trim();
  const timestamp = String(req.headers["x-cld-timestamp"] || "").trim();

  try {
    verifyCloudinaryWebhook({ rawBody, signature, timestamp });
    const body = parsePayload(rawBody);
    const eventId = deriveCloudinaryEventId(rawBody, timestamp, signature);
    const notificationType = String(body.notification_type || "").trim().toLowerCase();

    if (notificationType !== "eager") {
      return res.status(200).json({ received: true, ignored: true, correlationId });
    }

    const providerAssetId = String(body.public_id || "").trim();
    if (!providerAssetId) {
      return res.status(400).json({
        success: false,
        code: "CLOUDINARY_PUBLIC_ID_REQUIRED",
        message: "Cloudinary eager notification is missing public_id",
        correlationId,
      });
    }

    const outcome = eagerOutcome(body);
    if (!outcome) {
      return res.status(200).json({
        received: true,
        ignored: true,
        reason: "No terminal eager state",
        correlationId,
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const marker = await client.query(
        `INSERT INTO processed_webhook_events (event_id, provider, created_at)
         VALUES ($1, 'cloudinary', now())
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId]
      );
      if (!marker.rowCount) {
        await client.query("COMMIT");
        return res.status(200).json({ received: true, duplicated: true, correlationId });
      }

      const contentResult = await client.query(
        `SELECT id, type, status, adaptive_status, adaptive_qualities,
                lifecycle_state, is_approved, is_taken_down
           FROM content_items
          WHERE storage_provider = 'cloudinary'
            AND (provider_asset_id = $1 OR video_provider_asset_id = $1)
          LIMIT 1
          FOR UPDATE`,
        [providerAssetId]
      );
      const content = contentResult.rows[0];
      if (!content) {
        await client.query("ROLLBACK");
        return res.status(503).json({
          success: false,
          code: "CLOUDINARY_ASSET_MAPPING_PENDING",
          message: "Cloudinary asset mapping is not committed yet",
          correlationId,
        });
      }

      const current = String(content.status || "").toUpperCase();
      const currentAdaptive = String(content.adaptive_status || "NOT_APPLICABLE").toUpperCase();
      const isVideo = String(content.type || "").toUpperCase() === "VIDEO";
      const plannedQualities = Array.isArray(content.adaptive_qualities)
        ? content.adaptive_qualities.map((value: unknown) => String(value))
        : [];
      const successfulHls = successfulHlsResultCount(body.eager);
      const autoReady = hasSuccessfulAutoHlsResult(body.eager);
      const adaptiveEvidenceComplete =
        outcome === "READY" &&
        isVideo &&
        plannedQualities.length > 0 &&
        autoReady &&
        successfulHls >= plannedQualities.length + 1;

      const technicalOutcome = isVideo
        ? adaptiveEvidenceComplete
          ? "READY"
          : "FAILED"
        : outcome;
      const adaptiveOutcome = isVideo
        ? adaptiveEvidenceComplete
          ? "READY"
          : "FAILED"
        : currentAdaptive;

      const legal = current === "UPLOADING" || current === "PROCESSING";
      if (legal) {
        await client.query(
          `UPDATE content_items
              SET status = $2,
                  adaptive_status = $3
            WHERE id = $1`,
          [content.id, technicalOutcome, adaptiveOutcome]
        );
        await client.query(
          `INSERT INTO audit_logs (
             id, action, entity, entity_id, actor_id, actor_role, status,
             correlation_id, metadata, created_at
           ) VALUES (
             gen_random_uuid(), 'content.media_status_changed', 'content', $1,
             NULL, 'SYSTEM', 'success', NULL, $2, now()
           )`,
          [
            String(content.id),
            {
              provider: "cloudinary",
              provider_asset_id: providerAssetId,
              from_status: current,
              to_status: technicalOutcome,
              from_adaptive_status: currentAdaptive,
              to_adaptive_status: adaptiveOutcome,
              adaptive_qualities: plannedQualities,
              successful_hls_results: successfulHls,
              adaptive_master_ready: autoReady,
              notification_type: notificationType,
            },
          ]
        );
      }

      await client.query("COMMIT");
      return res.status(200).json({
        received: true,
        contentId: Number(content.id),
        technicalStatus: legal ? technicalOutcome : current,
        adaptiveStatus: legal ? adaptiveOutcome : currentAdaptive,
        ignored: !legal,
        correlationId,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error instanceof CloudinaryWebhookAuthError) {
      return res.status(error.code === "CLOUDINARY_WEBHOOK_NOT_CONFIGURED" ? 500 : 401).json({
        success: false,
        code: error.code,
        message: error.message,
        correlationId,
      });
    }
    if (Number(error?.statusCode) === 400) {
      return res.status(400).json({
        success: false,
        code: error?.code || "CLOUDINARY_WEBHOOK_INVALID",
        message: error?.message || "Invalid Cloudinary webhook",
        correlationId,
      });
    }
    return res.status(500).json({
      success: false,
      code: "CLOUDINARY_WEBHOOK_PROCESSING_FAILED",
      message: "Cloudinary webhook processing failed",
      correlationId,
    });
  }
};
