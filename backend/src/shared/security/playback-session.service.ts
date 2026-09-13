import { PoolClient } from "pg";
import { pool } from "../../common/db";
import { MediaAccessDeniedException } from "../exceptions/media.exception";
import { calculateHeartbeatAcceptance } from "./playback-heartbeat.policy";

const MAX_CONCURRENT_PLAYBACK_SESSIONS = 2;
const PLAYBACK_LOCK_NAMESPACE = 41_704;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
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

/**
 * Renews one explicit existing playback lease without allocating another
 * concurrency slot. The lease is reusable only by the same authenticated user
 * for the same content, and only while it is still active.
 *
 * Token refresh deliberately does not touch analytics_heartbeat_at, so signed
 * URL rotation cannot manufacture trusted listening time.
 */
export async function refreshPlaybackSessionLease(input: {
  sessionId: unknown;
  userId: unknown;
  contentId: unknown;
}): Promise<Date | null> {
  const sessionId = positiveInteger(input.sessionId);
  const userId = positiveInteger(input.userId);
  const contentId = positiveInteger(input.contentId);
  if (!sessionId || !userId || !contentId) return null;

  const result = await pool.query<{ heartbeat_at: Date }>(
    `UPDATE playback_sessions
        SET heartbeat_at = now()
      WHERE id = $1
        AND user_id = $2
        AND content_id = $3
        AND ended_at IS NULL
        AND heartbeat_at > now() - interval '5 minutes'
      RETURNING heartbeat_at`,
    [sessionId, userId, contentId]
  );

  return result.rows[0]?.heartbeat_at ?? null;
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

export type PlaybackHeartbeatResult = {
  lastSeen: Date;
  acceptedSeconds: number;
  totalTrustedSeconds: number;
  playCounted: boolean;
  duplicateOrReplay: boolean;
  acceptanceReason: string;
};

/**
 * Persist one trusted heartbeat atomically.
 *
 * Client position is never added directly to listening totals. The accepted
 * increment is bounded by server wall-clock elapsed time, forward player
 * progress, and the Phase-08 per-heartbeat cap. Monotonic sequence makes a
 * retry/replay idempotent. The first qualifying trusted increment records one
 * play for this playback session; later heartbeats cannot count it again.
 */
export async function heartbeatPlaybackSession(input: {
  sessionId: unknown;
  userId: unknown;
  contentId: unknown;
  sequence: unknown;
  currentPosition?: unknown;
  duration?: unknown;
}): Promise<PlaybackHeartbeatResult | null> {
  const sessionId = positiveInteger(input.sessionId);
  const userId = positiveInteger(input.userId);
  const contentId = positiveInteger(input.contentId);
  const sequence = positiveInteger(input.sequence);
  const currentPosition = nonNegativeInteger(input.currentPosition);
  const duration = nonNegativeInteger(input.duration);
  if (
    !sessionId ||
    !userId ||
    !contentId ||
    !sequence ||
    currentPosition === null ||
    duration === null
  ) {
    return null;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const selected = await client.query<{
      heartbeat_at: Date;
      analytics_heartbeat_at: Date | null;
      last_accepted_position: number;
      trusted_listened_seconds: string | number;
      last_heartbeat_sequence: string | number;
      play_counted_at: Date | null;
    }>(
      `SELECT heartbeat_at,
              analytics_heartbeat_at,
              last_accepted_position,
              trusted_listened_seconds,
              last_heartbeat_sequence,
              play_counted_at
         FROM playback_sessions
        WHERE id = $1
          AND user_id = $2
          AND content_id = $3
          AND ended_at IS NULL
          AND heartbeat_at > now() - interval '5 minutes'
        FOR UPDATE`,
      [sessionId, userId, contentId]
    );

    const row = selected.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    const nowMs = Date.now();
    const analyticsHeartbeatMs = row.analytics_heartbeat_at
      ? new Date(row.analytics_heartbeat_at).getTime()
      : null;
    const serverElapsedSeconds =
      analyticsHeartbeatMs === null
        ? null
        : Math.max(0, Math.floor((nowMs - analyticsHeartbeatMs) / 1000));

    const acceptance = calculateHeartbeatAcceptance({
      sequence,
      previousSequence: Number(row.last_heartbeat_sequence ?? 0),
      currentPosition,
      lastAcceptedPosition: Number(row.last_accepted_position ?? 0),
      serverElapsedSeconds,
    });

    if (acceptance.duplicateOrReplay) {
      await client.query("ROLLBACK");
      return {
        lastSeen: new Date(row.heartbeat_at),
        acceptedSeconds: 0,
        totalTrustedSeconds: Number(row.trusted_listened_seconds ?? 0),
        playCounted: Boolean(row.play_counted_at),
        duplicateOrReplay: true,
        acceptanceReason: acceptance.reason,
      };
    }

    let playCounted = Boolean(row.play_counted_at);
    let playCountedAt: Date | null = row.play_counted_at;

    if (!playCounted && acceptance.acceptedSeconds > 0) {
      const insertedPlay = await client.query(
        `INSERT INTO content_plays
           (content_id, user_id, playback_session_id, created_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (playback_session_id) WHERE playback_session_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [contentId, userId, sessionId]
      );

      if ((insertedPlay.rowCount ?? 0) > 0) {
        playCounted = true;
        playCountedAt = new Date();
        await client.query(
          `INSERT INTO playback_history (user_id, content_id, played_at)
           VALUES ($1, $2, now())
           ON CONFLICT (user_id, content_id)
           DO UPDATE SET played_at = EXCLUDED.played_at`,
          [userId, contentId]
        );
        await client.query(
          `INSERT INTO analytics_events
             (event_type, event_key, user_id, content_id, playback_session_id, created_at)
           VALUES ('PLAY_STARTED', $1, $2, $3, $4, now())
           ON CONFLICT (user_id, event_key) DO NOTHING`,
          [`session:${sessionId}:PLAY_STARTED`, userId, contentId, sessionId]
        );
      }
    }

    const updated = await client.query<{
      heartbeat_at: Date;
      trusted_listened_seconds: string | number;
    }>(
      `UPDATE playback_sessions
          SET heartbeat_at = now(),
              analytics_heartbeat_at = now(),
              current_position = $4,
              duration = $5,
              last_accepted_position = $6,
              trusted_listened_seconds = trusted_listened_seconds + $7,
              last_heartbeat_sequence = $8,
              play_counted_at = COALESCE(play_counted_at, $9)
        WHERE id = $1
          AND user_id = $2
          AND content_id = $3
        RETURNING heartbeat_at, trusted_listened_seconds`,
      [
        sessionId,
        userId,
        contentId,
        currentPosition,
        duration,
        acceptance.acceptedPosition,
        acceptance.acceptedSeconds,
        sequence,
        playCountedAt,
      ]
    );

    if (acceptance.acceptedSeconds > 0) {
      await client.query(
        `INSERT INTO user_listening_stats (user_id, year, month, total_seconds)
         VALUES (
           $1,
           EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::int,
           EXTRACT(MONTH FROM CURRENT_TIMESTAMP)::int,
           $2
         )
         ON CONFLICT (user_id, year, month)
         DO UPDATE SET total_seconds = user_listening_stats.total_seconds + EXCLUDED.total_seconds`,
        [userId, acceptance.acceptedSeconds]
      );
    }

    await client.query("COMMIT");

    return {
      lastSeen: updated.rows[0]?.heartbeat_at ?? new Date(),
      acceptedSeconds: acceptance.acceptedSeconds,
      totalTrustedSeconds: Number(updated.rows[0]?.trusted_listened_seconds ?? 0),
      playCounted,
      duplicateOrReplay: false,
      acceptanceReason: acceptance.reason,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
