import Redis from "ioredis";

export let redis: Redis | null = null;

function attachRedisListeners(client: Redis): void {
  // Redis is an optional cache. Errors are consumed here so they do not become
  // unhandled EventEmitter errors; readiness/dependency initialization records
  // configured connection failures explicitly.
  client.on("error", () => undefined);
}

/**
 * Configure Redis exclusively from the already-validated runtime contract.
 * No environment parsing or implicit localhost fallback is allowed here.
 */
export function configureRedis(redisUrl: string | null): Redis | null {
  if (redis) {
    redis.disconnect();
    redis = null;
  }

  if (!redisUrl) return null;

  redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: 2000,
    connectTimeout: 5000,
    retryStrategy(times) {
      return Math.min(times * 500, 10_000);
    },
  });
  attachRedisListeners(redis);
  return redis;
}

/**
 * Connect an explicitly configured Redis cache with bounded retries.
 * The caller decides whether failure is fatal or a degraded optional cache.
 */
export async function connectRedisWithRetry(maxAttempts = 3): Promise<void> {
  if (!redis) return;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (redis.status === "ready") return;
      if (redis.status === "wait" || redis.status === "close") {
        await redis.connect();
      }
      await redis.ping();
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 500, 2_000)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Redis connection failed");
}

export async function closeRedis(): Promise<void> {
  const client = redis;
  redis = null;
  if (!client) return;

  try {
    if (client.status === "ready" || client.status === "connect" || client.status === "connecting") {
      await client.quit();
      return;
    }
  } catch {
    // Fall through to an immediate disconnect during shutdown.
  }
  client.disconnect();
}
