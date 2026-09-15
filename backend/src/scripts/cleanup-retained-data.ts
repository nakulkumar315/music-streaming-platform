import crypto from "crypto";
import { pool } from "../common/db";
import { AuditService } from "../shared/audit/audit.service";

type Cutoffs = {
  sessionsBefore?: Date;
  playbackBefore?: Date;
  analyticsBefore?: Date;
};

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseOptionalDate(name: string): Date | undefined {
  const raw = argValue(name);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`--${name} must be a valid ISO-8601 timestamp`);
  }
  if (parsed.getTime() >= Date.now()) {
    throw new Error(`--${name} must be in the past`);
  }
  return parsed;
}

function parseCutoffs(): Cutoffs {
  const cutoffs: Cutoffs = {
    sessionsBefore: parseOptionalDate("sessions-before"),
    playbackBefore: parseOptionalDate("playback-before"),
    analyticsBefore: parseOptionalDate("analytics-before"),
  };
  if (!cutoffs.sessionsBefore && !cutoffs.playbackBefore && !cutoffs.analyticsBefore) {
    throw new Error(
      "No cleanup cutoff supplied. Provide one or more of --sessions-before, --playback-before, --analytics-before. Phase 09B intentionally has no default retention duration."
    );
  }
  return cutoffs;
}

function windowKey(cutoffs: Cutoffs) {
  const canonical = JSON.stringify({
    sessionsBefore: cutoffs.sessionsBefore?.toISOString() || null,
    playbackBefore: cutoffs.playbackBefore?.toISOString() || null,
    analyticsBefore: cutoffs.analyticsBefore?.toISOString() || null,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 48);
}

async function main() {
  const cutoffs = parseCutoffs();
  const key = windowKey(cutoffs);
  const lock = await pool.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext('phase09b-retention-cleanup')) AS locked"
  );
  if (!lock.rows[0]?.locked) {
    throw new Error("Another Phase 09B retention cleanup is already running");
  }

  try {
    const claim = await pool.query<{ run_token: string }>(
      `INSERT INTO operational_job_runs (job_name, window_key, status, started_at)
       VALUES ('phase09b-retention-cleanup', $1, 'RUNNING', now())
       ON CONFLICT (job_name, window_key) DO UPDATE
         SET run_token = gen_random_uuid(),
             status = 'RUNNING',
             started_at = now(),
             completed_at = NULL,
             last_error = NULL
       WHERE operational_job_runs.status = 'FAILED'
       RETURNING run_token`,
      [key]
    );

    if (!claim.rows[0]) {
      const previous = await pool.query<{ status: string }>(
        `SELECT status FROM operational_job_runs
          WHERE job_name = 'phase09b-retention-cleanup' AND window_key = $1`,
        [key]
      );
      console.log(
        JSON.stringify(
          {
            operation: "phase09b-retention-cleanup",
            skipped: true,
            reason: `window already ${String(previous.rows[0]?.status || "claimed").toLowerCase()}`,
            windowKey: key,
          },
          null,
          2
        )
      );
      return;
    }

    const client = await pool.connect();
    let counts = { sessions: 0, playbackSessions: 0, analyticsEvents: 0 };
    try {
      await client.query("BEGIN");
      if (cutoffs.sessionsBefore) {
        const result = await client.query(
          `DELETE FROM user_sessions
            WHERE last_active_at < $1
            RETURNING id`,
          [cutoffs.sessionsBefore]
        );
        counts.sessions = Number(result.rowCount || 0);
      }

      if (cutoffs.playbackBefore) {
        const result = await client.query(
          `DELETE FROM playback_sessions
            WHERE ended_at IS NOT NULL
              AND ended_at < $1
            RETURNING id`,
          [cutoffs.playbackBefore]
        );
        counts.playbackSessions = Number(result.rowCount || 0);
      }

      if (cutoffs.analyticsBefore) {
        const result = await client.query(
          `DELETE FROM analytics_events
            WHERE created_at < $1
            RETURNING id`,
          [cutoffs.analyticsBefore]
        );
        counts.analyticsEvents = Number(result.rowCount || 0);
      }

      await AuditService.logCritical(
        {
          action: "privacy.retention_cleanup_completed",
          entity: "retention_window",
          entityId: key,
          role: "system",
          status: "success",
          metadata: {
            sessionsBefore: cutoffs.sessionsBefore?.toISOString() || null,
            playbackBefore: cutoffs.playbackBefore?.toISOString() || null,
            analyticsBefore: cutoffs.analyticsBefore?.toISOString() || null,
            ...counts,
          },
        },
        client
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    await pool.query(
      `UPDATE operational_job_runs
          SET status = 'COMPLETED', completed_at = now(), last_error = NULL
        WHERE job_name = 'phase09b-retention-cleanup'
          AND window_key = $1
          AND run_token = $2`,
      [key, claim.rows[0].run_token]
    );

    console.log(
      JSON.stringify(
        {
          operation: "phase09b-retention-cleanup",
          windowKey: key,
          cutoffs: {
            sessionsBefore: cutoffs.sessionsBefore?.toISOString() || null,
            playbackBefore: cutoffs.playbackBefore?.toISOString() || null,
            analyticsBefore: cutoffs.analyticsBefore?.toISOString() || null,
          },
          deleted: counts,
        },
        null,
        2
      )
    );
  } catch (error) {
    await pool.query(
      `UPDATE operational_job_runs
          SET status = 'FAILED', completed_at = now(), last_error = $2
        WHERE job_name = 'phase09b-retention-cleanup'
          AND window_key = $1
          AND status = 'RUNNING'`,
      [key, (error instanceof Error ? error.message : String(error)).slice(0, 2000)]
    ).catch(() => undefined);
    throw error;
  } finally {
    await pool.query("SELECT pg_advisory_unlock(hashtext('phase09b-retention-cleanup'))").catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("Phase 09B retention cleanup failed", error);
  process.exit(1);
});
