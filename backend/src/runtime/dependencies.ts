import type { EnvValidationResult } from "../config/env.validation";
import { pool } from "../common/db";
import { assertDatabaseSchemaReady } from "../common/db/schema-readiness";
import { configureRedis, connectRedisWithRetry, redis } from "../common/redis";
import { createStorageProvider } from "../shared/storage/factory/storage-provider.factory";
import { getDeliveryStrategyForProvider } from "../shared/delivery/services/media-delivery.service";

export type DependencyInitializationResult = {
  schemaVersion: string;
  database: string;
  cache: "disabled" | "ready" | "degraded";
};

/**
 * Initialize every dependency whose state must be known before the HTTP
 * listener opens. PostgreSQL/schema/storage are critical. Redis is an optional
 * cache; if explicitly configured but unavailable the service can continue on
 * DB-backed paths while reporting cache=degraded.
 */
export async function initializeDependencies(
  runtime: EnvValidationResult
): Promise<DependencyInitializationResult> {
  await pool.query("SELECT 1");
  const schema = await assertDatabaseSchemaReady();

  createStorageProvider();
  getDeliveryStrategyForProvider(runtime.storageProvider);

  configureRedis(runtime.redisUrl);
  let cache: DependencyInitializationResult["cache"] = "disabled";
  if (runtime.redisUrl) {
    try {
      await connectRedisWithRetry(3);
      cache = redis?.status === "ready" ? "ready" : "degraded";
    } catch {
      cache = "degraded";
    }
  }

  return {
    schemaVersion: schema.version,
    database: schema.database,
    cache,
  };
}
