import type { EnvValidationResult } from "../config/env.validation";
import { pool } from "../common/db";
import { assertDatabaseSchemaReady } from "../common/db/schema-readiness";
import { connectRedisWithRetry, redis } from "../common/redis";
import { createStorageProvider } from "../shared/storage/factory/storage-provider.factory";
import { getDeliveryStrategyForProvider } from "../shared/delivery/services/media-delivery.service";

export type DependencyInitializationResult = {
  schemaVersion: string;
  database: string;
  cache: "disabled" | "ready" | "degraded";
};

/**
 * Initialize every dependency that must be known before the HTTP listener opens.
 * Redis is an optional cache: when explicitly configured but unavailable the
 * service can continue with DB-backed behavior and reports cache=degraded.
 */
export async function initializeDependencies(
  runtime: EnvValidationResult
): Promise<DependencyInitializationResult> {
  await pool.query("SELECT 1");

  const schema = await assertDatabaseSchemaReady();

  createStorageProvider();
  getDeliveryStrategyForProvider(runtime.storageProvider);

  let cache: DependencyInitializationResult["cache"] = "disabled";
  if (runtime.redisUrl) {
    await connectRedisWithRetry(3);
    cache = redis && redis.status === "ready" ? "ready" : "degraded";
  }

  return {
    schemaVersion: schema.version,
    database: schema.database,
    cache,
  };
}
