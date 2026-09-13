import { PoolClient } from "pg";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { MediaAccessDeniedException } from "../exceptions/media.exception";

const MAX_CONCURRENT_PLAYBACK_SESSIONS = 2;
const PLAYBACK_LOCK_NAMESPACE = 41_704;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function lockUserPlayback(client: PoolClient, userId: number): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
    PLAYBACK_LOCK_NAMESPACE,
    userId,
  ]);
}

export async function createPlaybackSession(
  rawUserId: unknown,
  rawContentId: unknown
): Promise<number> {
  const userId = positiveInteger(rawUserId);
  const contentId = positiveInteger(rawContentId);
  if (!userId || !contentId) {
    throw new MediaAccessDeniedException(
      "Authenticated playback session required",
      "AUTHENTICATION_REQUIRED"
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockUserPlayback(client, userId);

    await client.query(
      `DELETE FROM playback_sessions
        WHERE user_id = $1
          AND (ended_at IS NOT NULL OR heartbeat_at <= now() - interval '5 minutes')`,
      [userId]
    );

    const active = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM playback_sessions
        WHERE user_id = $1
          AND ended_at IS NULL
          AND heartbeat_at > now() - interval '5 minutes'`,
      [userId]
    );

    if (Number(active.rows[0]?.count ?? 0) >= MAX_CONCURRENT_PLAYBACK_SESSIONS) {
      throw new MediaAccessDeniedException(
        "Too many concurrent streams. Close another playback session and retry.",
        "PLAYBACK_SESSION_LIMIT"
      );
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO playback_sessions
         (user_id, content_id, started_at, heartbeat_at, current_position, duration, ended_at)
       VALUES ($1, $2, now(), now(), 0, 0, NULL)
       RETURNING id`,
      [userId, contentId]
    );

    const sessionId = Number(inserted.rows[0]?.id);
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      throw new Error("Playback session persistence failed");
    }

    await client.query("COMMIT");
    return sessionId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function discardPlaybackSession(
  sessionId: number,
  userId: number,
  contentId: number
): Promise<void> {
  await pool.query(
    `DELETE FROM playback_sessions
      WHERE id = $1 AND user_id = $2 AND content_id = $3`,
    [sessionId, userId, contentId]
  );
}

export async function isPlaybackSessionActive(
  rawSessionId: unknown,
  rawUserId: unknown,
  rawContentId: unknown
): Promise<boolean> {
  const sessionId = positiveInteger(rawSessionId);
  const userId = positiveInteger(rawUserId);
  const contentId = positiveInteger(rawContentId);
  if (!sessionId || !userId || !contentId) return false;

  const result = await pool.query(
    `SELECT 1
       FROM playback_sessions
      WHERE id = $1
        AND user_id = $2
        AND content_id = $3
        AND ended_at IS NULL
        AND heartbeat_at > now() - interval '5 minutes'
      LIMIT 1`,
    [sessionId, userId, contentId]
  );
  return result.rowCount === 1;
}

export async function heartbeatPlaybackSession(input: {
  sessionId: unknown;
  userId: unknown;
  contentId: unknown;
  currentPosition?: unknown;
  duration?: unknown;
}): Promise<Date | null> {
  const sessionId = positiveInteger(input.sessionId);
  const userId = positiveInteger(input.userId);
  const contentId = positiveInteger(input.contentId);
  if (!sessionId || !userId || !contentId) return null;

  const currentPosition = Math.max(0, Math.floor(Number(input.currentPosition) || 0));
  const duration = Math.max(0, Math.floor(Number(input.duration) || 0));

  const result = await pool.query<{ heartbeat_at: Date }>(
    `UPDATE playback_sessions
        SET heartbeat_at = now(),
            current_position = $4,
            duration = $5
      WHERE id = $1
        AND user_id = $2
        AND content_id = $3
        AND ended_at IS NULL
        AND heartbeat_at > now() - interval '5 minutes'
      RETURNING heartbeat_at`,
    [sessionId, userId, contentId, currentPosition, duration]
  );

  return result.rows[0]?.heartbeat_at ?? null;
}

export async function terminatePlaybackSession(input: {
  sessionId: unknown;
  userId: unknown;
  contentId: unknown;
}): Promise<boolean> {
  const sessionId = positiveInteger(input.sessionId);
  const userId = positiveInteger(input.userId);
  const contentId = positiveInteger(input.contentId);
  if (!sessionId || !userId || !contentId) return false;

  const result = await pool.query(
    `UPDATE playback_sessions
        SET ended_at = now(), heartbeat_at = now()
      WHERE id = $1
        AND user_id = $2
        AND content_id = $3
        AND ended_at IS NULL`,
    [sessionId, userId, contentId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function recordPlaybackStarted(
  userId: number,
  contentId: number
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO content_plays (content_id, user_id, created_at)
       VALUES ($1, $2, now())`,
      [contentId, userId]
    );

    await pool.query(
      `INSERT INTO playback_history (user_id, content_id, played_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, content_id)
       DO UPDATE SET played_at = EXCLUDED.played_at`,
      [userId, contentId]
    );
  } catch (error) {
    logger.error({ error, userId, contentId }, "[Playback] Failed to record play analytics");
  }
}
