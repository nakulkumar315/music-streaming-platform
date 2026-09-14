import { v2 as cloudinary } from "cloudinary";

import { pool } from "../common/db";
import { getStorageConfig } from "../config/storage.config";
import {
  cloudinaryEagerTransformsForSourceHeight,
  qualitiesForSourceHeight,
} from "../modules/media/adaptive-renditions";
import { normalizePublicId, isValidPublicId } from "../shared/utils/cloudinary.utils";

const ADVISORY_LOCK_KEY = 90209012;

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function markFailed(contentId: number, reason: string): Promise<void> {
  await pool.query(
    `UPDATE content_items
        SET adaptive_status = 'FAILED',
            status = 'FAILED'
      WHERE id = $1
        AND adaptive_status = 'PENDING'`,
    [contentId]
  );
  await pool.query(
    `INSERT INTO audit_logs (
       id, action, entity, entity_id, actor_id, actor_role, status,
       correlation_id, metadata, created_at
     ) VALUES (
       gen_random_uuid(), 'content.adaptive_backfill_failed', 'content', $1,
       NULL, 'SYSTEM', 'failed', NULL, $2, now()
     )`,
    [String(contentId), { reason }]
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = positiveInteger(process.env.ADAPTIVE_BACKFILL_LIMIT, 100);
  const storage = getStorageConfig();
  const cfg = storage.cloudinary;

  if (!cfg.cloudName || !cfg.apiKey || !cfg.apiSecret) {
    throw new Error("Cloudinary configuration is required for adaptive backfill");
  }
  if (!cfg.webhookUrl) {
    throw new Error("CLOUDINARY_WEBHOOK_URL is required for adaptive backfill completion");
  }

  cloudinary.config({
    cloud_name: cfg.cloudName,
    api_key: cfg.apiKey,
    api_secret: cfg.apiSecret,
    secure: true,
    analytics: false,
    urlAnalytics: false,
  });

  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [ADVISORY_LOCK_KEY]
    );
    if (!lock.rows[0]?.locked) {
      throw new Error("Adaptive video backfill is already running");
    }

    const result = await pool.query<{
      id: number;
      provider_asset_id: string | null;
      video_provider_asset_id: string | null;
      status: string;
    }>(
      `SELECT id, provider_asset_id, video_provider_asset_id, status
         FROM content_items
        WHERE UPPER(type) = 'VIDEO'
          AND LOWER(storage_provider) = 'cloudinary'
          AND adaptive_status = 'PENDING'
        ORDER BY id ASC
        LIMIT $1`,
      [limit]
    );

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            pending: result.rows.length,
            ids: result.rows.map((row) => Number(row.id)),
          },
          null,
          2
        )
      );
      return;
    }

    let scheduled = 0;
    let failed = 0;

    for (const row of result.rows) {
      const contentId = Number(row.id);
      const rawProviderId = String(
        row.video_provider_asset_id || row.provider_asset_id || ""
      ).trim();

      try {
        const publicId = normalizePublicId(rawProviderId);
        if (!publicId || !isValidPublicId(publicId)) {
          throw new Error("Provider asset identity is missing or invalid");
        }

        const resource: any = await cloudinary.api.resource(publicId, {
          resource_type: "video",
          type: "authenticated",
        });
        const sourceWidth = Number(resource?.width);
        const sourceHeight = Number(resource?.height);
        if (
          !Number.isSafeInteger(sourceWidth) ||
          sourceWidth <= 0 ||
          !Number.isSafeInteger(sourceHeight) ||
          sourceHeight <= 0
        ) {
          throw new Error("Cloudinary did not return valid source dimensions");
        }

        const qualities = qualitiesForSourceHeight(sourceHeight);
        if (!qualities.length) {
          throw new Error("Source is below the minimum non-upscaled adaptive rendition");
        }
        const eager = cloudinaryEagerTransformsForSourceHeight(sourceHeight);

        await pool.query(
          `UPDATE content_items
              SET source_width = $2,
                  source_height = $3,
                  adaptive_qualities = $4::text[],
                  adaptive_status = 'PENDING',
                  status = 'PROCESSING'
            WHERE id = $1
              AND adaptive_status = 'PENDING'`,
          [contentId, sourceWidth, sourceHeight, qualities]
        );

        await cloudinary.uploader.explicit(publicId, {
          resource_type: "video",
          type: "authenticated",
          eager,
          eager_async: true,
          eager_notification_url: cfg.webhookUrl,
        } as any);

        await pool.query(
          `INSERT INTO audit_logs (
             id, action, entity, entity_id, actor_id, actor_role, status,
             correlation_id, metadata, created_at
           ) VALUES (
             gen_random_uuid(), 'content.adaptive_backfill_scheduled', 'content', $1,
             NULL, 'SYSTEM', 'success', NULL, $2, now()
           )`,
          [
            String(contentId),
            {
              source_width: sourceWidth,
              source_height: sourceHeight,
              adaptive_qualities: qualities,
              previous_status: String(row.status || ""),
            },
          ]
        );
        scheduled += 1;
      } catch (error: any) {
        failed += 1;
        await markFailed(contentId, String(error?.message || "Adaptive backfill failed"));
        console.error(`[adaptive-backfill] content=${contentId} failed`);
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun: false,
          scanned: result.rows.length,
          scheduled,
          failed,
          remainingMayExist: result.rows.length === limit,
        },
        null,
        2
      )
    );
  } finally {
    await lockClient
      .query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY])
      .catch(() => undefined);
    lockClient.release();
    await pool.end().catch(() => undefined);
  }
}

main().catch(async (error) => {
  console.error(`[adaptive-backfill] ${error instanceof Error ? error.message : String(error)}`);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
