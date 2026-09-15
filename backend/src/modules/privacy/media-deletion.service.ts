import type { PoolClient } from "pg";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { getStorageProviderByName } from "../../shared/storage/factory/storage-provider.factory";
import type { StorageProviderName } from "../../shared/storage/interfaces/storage-types.interface";
import { AuditService } from "../../shared/audit/audit.service";

const MAX_BATCH = 50;
const MAX_RETRY_SECONDS = 24 * 60 * 60;
const SUPPORTED_PROVIDERS = new Set<StorageProviderName>([
  "local",
  "firebase",
  "s3",
  "cloudinary",
]);

export type MediaDeletionRunResult = {
  claimed: number;
  completed: number;
  failed: number;
};

export type QueueContentDeletionResult = {
  contentId: number;
  queued: number;
  alreadyCompleted: boolean;
};

type DeletionRow = {
  id: string;
  entity_type: "USER_ASSET" | "CONTENT_ASSET";
  entity_id: string;
  asset_kind: string;
  storage_provider: StorageProviderName;
  storage_key: string;
  provider_asset_id: string | null;
  attempt_count: number;
};

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function boundedBatch(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, MAX_BATCH);
}

function retryDelaySeconds(attempt: number): number {
  const exponent = Math.max(0, Math.min(10, attempt - 1));
  return Math.min(MAX_RETRY_SECONDS, 300 * 2 ** exponent);
}

function privacyError(message: string, status: number, code: string) {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Queue physical deletion only after business takedown has already made content
 * inaccessible. Historical ownership/provider identity remains in the content
 * row for audit/reconciliation even after the provider objects are removed.
 */
export async function queueContentPhysicalDeletion(
  rawContentId: number,
  requestedBy?: number
): Promise<QueueContentDeletionResult> {
  const contentId = positiveInteger(rawContentId);
  const actorId = positiveInteger(requestedBy);
  if (!contentId) throw privacyError("Invalid content id", 400, "INVALID_CONTENT_ID");

  return transaction(async (client) => {
    const result = await client.query<any>(
      `SELECT id, type, is_taken_down, storage_provider,
              storage_key, video_storage_key, thumbnail_storage_key,
              provider_asset_id, audio_provider_asset_id,
              video_provider_asset_id, thumbnail_provider_asset_id,
              physical_deletion_status
         FROM content_items
        WHERE id = $1
        FOR UPDATE`,
      [contentId]
    );
    const content = result.rows[0];
    if (!content) throw privacyError("Content not found", 404, "CONTENT_NOT_FOUND");
    if (content.is_taken_down !== true) {
      throw privacyError(
        "Content must be taken down before physical deletion can be requested",
        409,
        "CONTENT_TAKEDOWN_REQUIRED"
      );
    }
    if (String(content.physical_deletion_status || "").toUpperCase() === "COMPLETED") {
      return { contentId, queued: 0, alreadyCompleted: true };
    }

    const provider = String(content.storage_provider || "").toLowerCase() as StorageProviderName;
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      throw privacyError("Content storage provider is invalid", 409, "CONTENT_STORAGE_INVALID");
    }

    const type = String(content.type || "").toUpperCase();
    const mainStorageKey =
      type === "VIDEO"
        ? String(content.video_storage_key || content.storage_key || "").trim()
        : String(content.storage_key || "").trim();
    const mainProviderAssetId =
      type === "VIDEO"
        ? content.video_provider_asset_id || content.provider_asset_id
        : content.audio_provider_asset_id || content.provider_asset_id;

    const assets = [
      mainStorageKey
        ? {
            kind: type === "VIDEO" ? "VIDEO_MASTER" : "AUDIO_MASTER",
            storageKey: mainStorageKey,
            providerAssetId: mainProviderAssetId ? String(mainProviderAssetId) : null,
          }
        : null,
      content.thumbnail_storage_key
        ? {
            kind: "THUMBNAIL",
            storageKey: String(content.thumbnail_storage_key),
            providerAssetId: content.thumbnail_provider_asset_id
              ? String(content.thumbnail_provider_asset_id)
              : null,
          }
        : null,
    ].filter(Boolean) as Array<{
      kind: string;
      storageKey: string;
      providerAssetId: string | null;
    }>;

    if (!assets.length) {
      throw privacyError("Content has no deletable provider mapping", 409, "CONTENT_MEDIA_MAPPING_MISSING");
    }

    let queued = 0;
    for (const asset of assets) {
      const inserted = await client.query(
        `INSERT INTO media_deletion_requests (
           entity_type, entity_id, asset_kind, storage_provider, storage_key,
           provider_asset_id, requested_by
         ) VALUES ('CONTENT_ASSET', $1, $2, $3, $4, $5, $6)
         ON CONFLICT (entity_type, entity_id, asset_kind, storage_provider, storage_key)
         DO NOTHING
         RETURNING id`,
        [String(contentId), asset.kind, provider, asset.storageKey, asset.providerAssetId, actorId]
      );
      queued += Number(inserted.rowCount || 0);
    }

    await client.query(
      `UPDATE content_items
          SET physical_deletion_status = 'PENDING',
              physical_deletion_requested_at = COALESCE(physical_deletion_requested_at, now()),
              physical_deleted_at = NULL
        WHERE id = $1`,
      [contentId]
    );

    await AuditService.logCritical(
      {
        action: "privacy.content_physical_deletion_requested",
        entity: "content",
        entityId: String(contentId),
        performedBy: actorId || undefined,
        role: actorId ? "admin" : "system",
        status: "pending",
        metadata: { assetsExpected: assets.length, assetsNewlyQueued: queued, storageProvider: provider },
      },
      client
    );

    return { contentId, queued, alreadyCompleted: false };
  });
}

async function claimBatch(limit: number): Promise<DeletionRow[]> {
  return transaction(async (client) => {
    const result = await client.query<DeletionRow>(
      `WITH candidates AS (
         SELECT id
           FROM media_deletion_requests
          WHERE status IN ('PENDING', 'FAILED')
            AND next_attempt_at <= now()
          ORDER BY requested_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE media_deletion_requests q
          SET status = 'PROCESSING',
              attempt_count = q.attempt_count + 1,
              last_error = NULL,
              updated_at = now()
         FROM candidates c
        WHERE q.id = c.id
       RETURNING q.id, q.entity_type, q.entity_id, q.asset_kind,
                 q.storage_provider, q.storage_key, q.provider_asset_id,
                 q.attempt_count`,
      [limit]
    );
    return result.rows;
  });
}

async function markCompleted(row: DeletionRow) {
  await transaction(async (client) => {
    await client.query(
      `UPDATE media_deletion_requests
          SET status = 'COMPLETED',
              completed_at = now(),
              last_error = NULL,
              updated_at = now()
        WHERE id = $1
          AND status = 'PROCESSING'`,
      [row.id]
    );

    if (row.entity_type === "CONTENT_ASSET") {
      const remaining = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM media_deletion_requests
          WHERE entity_type = 'CONTENT_ASSET'
            AND entity_id = $1
            AND status <> 'COMPLETED'`,
        [row.entity_id]
      );
      if (Number(remaining.rows[0]?.count || 0) === 0) {
        await client.query(
          `UPDATE content_items
              SET physical_deletion_status = 'COMPLETED',
                  physical_deleted_at = now()
            WHERE id = $1`,
          [Number(row.entity_id)]
        );
      }
    }

    await AuditService.logCritical(
      {
        action: "privacy.media_deleted",
        entity: row.entity_type.toLowerCase(),
        entityId: row.entity_id,
        role: "system",
        status: "success",
        metadata: {
          deletionRequestId: row.id,
          assetKind: row.asset_kind,
          storageProvider: row.storage_provider,
          attempts: row.attempt_count,
        },
      },
      client
    );
  });
}

async function markFailed(row: DeletionRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const delaySeconds = retryDelaySeconds(row.attempt_count);

  await transaction(async (client) => {
    await client.query(
      `UPDATE media_deletion_requests
          SET status = 'FAILED',
              last_error = $2,
              next_attempt_at = now() + ($3::text || ' seconds')::interval,
              updated_at = now()
        WHERE id = $1
          AND status = 'PROCESSING'`,
      [row.id, message.slice(0, 2000), delaySeconds]
    );
    if (row.entity_type === "CONTENT_ASSET") {
      await client.query(
        `UPDATE content_items
            SET physical_deletion_status = 'FAILED'
          WHERE id = $1
            AND physical_deletion_status <> 'COMPLETED'`,
        [Number(row.entity_id)]
      );
    }
  });

  logger.warn(
    {
      deletionRequestId: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      storageProvider: row.storage_provider,
      attempt: row.attempt_count,
      retryDelaySeconds: delaySeconds,
    },
    "[Privacy] Provider asset deletion failed and remains retryable"
  );
}

/**
 * Process provider-confirmed physical deletions.
 *
 * A request is completed only after the provider delete call returns success.
 * Concurrent workers safely share the queue through FOR UPDATE SKIP LOCKED.
 */
export async function processMediaDeletionQueue(
  requestedBatchSize?: number
): Promise<MediaDeletionRunResult> {
  const rows = await claimBatch(boundedBatch(requestedBatchSize));
  let completed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const provider = getStorageProviderByName(row.storage_provider);
      await provider.delete(row.storage_key, row.provider_asset_id || undefined);
      await markCompleted(row);
      completed += 1;
    } catch (error) {
      await markFailed(row, error);
      failed += 1;
    }
  }

  return { claimed: rows.length, completed, failed };
}
