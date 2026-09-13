import crypto from "crypto";
import { pool } from "../common/db";
import { logger } from "../common/logger";

const STALE_CLAIM_MINUTES = 15;

export function jobWindowKey(periodMs: number, now = Date.now()): string {
  const boundedPeriod = Math.max(60_000, Math.floor(periodMs));
  const windowStart = Math.floor(now / boundedPeriod) * boundedPeriod;
  return new Date(windowStart).toISOString();
}

async function claimJob(jobName: string, windowKey: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const result = await pool.query<{ run_token: string }>(
    `INSERT INTO operational_job_runs
       (job_name, window_key, run_token, status, started_at, completed_at, last_error)
     VALUES ($1, $2, $3, 'RUNNING', now(), NULL, NULL)
     ON CONFLICT (job_name, window_key)
     DO UPDATE SET
       run_token = EXCLUDED.run_token,
       status = 'RUNNING',
       started_at = now(),
       completed_at = NULL,
       last_error = NULL
     WHERE operational_job_runs.status = 'FAILED'
        OR (
          operational_job_runs.status = 'RUNNING'
          AND operational_job_runs.started_at < now() - ($4::text || ' minutes')::interval
        )
     RETURNING run_token`,
    [jobName, windowKey, token, STALE_CLAIM_MINUTES]
  );

  return result.rows[0]?.run_token === token ? token : null;
}

async function finishJob(
  jobName: string,
  windowKey: string,
  runToken: string,
  status: "COMPLETED" | "FAILED",
  error?: unknown
): Promise<void> {
  const safeError = error
    ? String(error instanceof Error ? error.message : error).slice(0, 1000)
    : null;
  await pool.query(
    `UPDATE operational_job_runs
        SET status = $4,
            completed_at = now(),
            last_error = $5
      WHERE job_name = $1
        AND window_key = $2
        AND run_token = $3`,
    [jobName, windowKey, runToken, status, safeError]
  );
}

/**
 * Run one scheduled job at most once per deterministic time window across all
 * API replicas. Failed/stale claims may be taken over; ownership token prevents
 * an old runner from completing a newer retry's claim.
 */
export async function runClaimedJob(
  jobName: string,
  periodMs: number,
  job: () => Promise<void>
): Promise<boolean> {
  const windowKey = jobWindowKey(periodMs);
  const runToken = await claimJob(jobName, windowKey);
  if (!runToken) return false;

  try {
    await job();
    await finishJob(jobName, windowKey, runToken, "COMPLETED");
    return true;
  } catch (error) {
    await finishJob(jobName, windowKey, runToken, "FAILED", error).catch((persistError) => {
      logger.error(
        { persistError, jobName, windowKey },
        "[Scheduler] Failed to persist job failure state"
      );
    });
    throw error;
  }
}
