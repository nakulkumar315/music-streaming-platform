import { pool } from "../../common/db";

const MAX_PROGRESS_MS = 24 * 60 * 60 * 1000;
const COMPLETION_RATIO = 0.95;

export type NormalizedPlaybackProgress = {
  positionMs: number;
  durationMs: number | null;
  completed: boolean;
};

export type PlaybackProgressRecord = NormalizedPlaybackProgress & {
  contentId: number;
  updatedAt: Date;
};

function finiteNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

/**
 * Normalizes untrusted client progress without accepting impossible values.
 * Explicit backward seeks are allowed: the newest authenticated player state
 * is authoritative for UX resume, while trusted listening analytics live in a
 * separate domain.
 */
export function normalizePlaybackProgress(
  rawPositionMs: unknown,
  rawDurationMs: unknown
): NormalizedPlaybackProgress {
  const rawPosition = finiteNonNegativeInteger(rawPositionMs) ?? 0;
  const rawDuration = finiteNonNegativeInteger(rawDurationMs);
  const durationMs =
    rawDuration === null ? null : Math.min(rawDuration, MAX_PROGRESS_MS);
  const positionCeiling = durationMs && durationMs > 0 ? durationMs : MAX_PROGRESS_MS;
  const positionMs = Math.min(rawPosition, positionCeiling);
  const completed =
    durationMs !== null &&
    durationMs > 0 &&
    positionMs >= Math.floor(durationMs * COMPLETION_RATIO);

  return { positionMs, durationMs, completed };
}

export async function getPlaybackProgress(
  userId: number,
  contentId: number
): Promise<PlaybackProgressRecord | null> {
  const result = await pool.query<{
    content_id: number;
    position_ms: number;
    duration_ms: number | null;
    completed: boolean;
    updated_at: Date;
  }>(
    `SELECT content_id, position_ms, duration_ms, completed, updated_at
       FROM playback_progress
      WHERE user_id = $1 AND content_id = $2
      LIMIT 1`,
    [userId, contentId]
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    contentId: Number(row.content_id),
    positionMs: Number(row.position_ms),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    completed: Boolean(row.completed),
    updatedAt: row.updated_at,
  };
}

export async function savePlaybackProgress(input: {
  userId: number;
  contentId: number;
  positionMs: unknown;
  durationMs: unknown;
}): Promise<PlaybackProgressRecord> {
  const normalized = normalizePlaybackProgress(input.positionMs, input.durationMs);

  const result = await pool.query<{
    content_id: number;
    position_ms: number;
    duration_ms: number | null;
    completed: boolean;
    updated_at: Date;
  }>(
    `INSERT INTO playback_progress
       (user_id, content_id, position_ms, duration_ms, completed, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id, content_id)
     DO UPDATE SET
       position_ms = EXCLUDED.position_ms,
       duration_ms = EXCLUDED.duration_ms,
       completed = EXCLUDED.completed,
       updated_at = now()
     RETURNING content_id, position_ms, duration_ms, completed, updated_at`,
    [
      input.userId,
      input.contentId,
      normalized.positionMs,
      normalized.durationMs,
      normalized.completed,
    ]
  );

  const row = result.rows[0];
  return {
    contentId: Number(row.content_id),
    positionMs: Number(row.position_ms),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    completed: Boolean(row.completed),
    updatedAt: row.updated_at,
  };
}
