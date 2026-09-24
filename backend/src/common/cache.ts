import { redis } from "./redis";

export async function getCache<T = any>(key: string): Promise<T | null> {
  try {
    if (!redis) return null;
    const data = await redis.get(key);
    if (data) {
      return JSON.parse(data) as T;
    }
    return null;
  } catch (err: any) {
    return null;
  }
}

export async function setCache(key: string, value: any, ttl: number = 120): Promise<void> {
  try {
    if (!redis) return;
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch (err: any) {
  }
}

export async function deleteCache(key: string): Promise<void> {
  try {
    if (!redis) return;
    await redis.del(key);
  } catch (err: any) {
  }
}

export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = 120
): Promise<T> {
  const cached = await getCache<T>(key);
  if (cached) return cached;

  const data = await fetcher();

  if (data !== undefined && data !== null) {
    await setCache(key, data, ttlSeconds);
  }

  return data;
}

export const invalidateCache = deleteCache;

/**
 * Invalidate all cache keys matching a specific pattern using non-blocking SCAN.
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  const startTime = Date.now();
  try {
    if (!redis) {
      console.log(`[CACHE] Redis disabled, skipping invalidate for pattern ${pattern}`);
      return;
    }
    let cursor = "0";
    let deletedCount = 0;
    let scanCount = 0;
    
    do {
      const scanStart = Date.now();
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      scanCount++;
      console.log(`[CACHE] SCAN #${scanCount} for pattern ${pattern} took ${Date.now() - scanStart}ms, found ${keys.length} keys`);
      
      if (keys.length > 0) {
        const delStart = Date.now();
        await redis.del(...keys);
        console.log(`[CACHE] DEL ${keys.length} keys took ${Date.now() - delStart}ms`);
        deletedCount += keys.length;
      }
    } while (cursor !== "0");

    console.log(`[CACHE INVALIDATED] pattern ${pattern} matched ${deletedCount} keys in ${Date.now() - startTime}ms total`);
  } catch (err: any) {
    console.error(`[Redis] pattern DEL error for ${pattern} after ${Date.now() - startTime}ms:`, err.message);
  }
}

/**
 * Invalidate artist-related caches.
 */
export async function invalidateArtistCache(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([
        invalidateCachePattern("artist_search:*"),
        invalidateCachePattern("featured_artists:*"),
        invalidateCachePattern("home_content_feed_rows*"),
      ]),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch (err: any) {
    console.error("[CACHE] invalidateArtistCache error:", err?.message);
  }
}

/**
 * Invalidate content-related caches.
 * Non-blocking - runs in background with timeout protection.
 */
export async function invalidateContentCache(): Promise<void> {
  // Fire and forget - don't await this in API routes
  setImmediate(async () => {
    try {
      // Add timeout wrapper to prevent indefinite blocking
      await Promise.race([
        invalidateCachePattern("home_content_feed_rows*"),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Cache invalidate timeout")), 5000)
        )
      ]);
    } catch (err: any) {
      console.error("[CACHE] Background invalidate failed:", err.message);
    }
  });
}
