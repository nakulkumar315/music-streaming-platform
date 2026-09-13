import { pool } from "../common/db";
import { logger } from "../common/logger";
import { NotificationService } from "../shared/notifications/notification.service";
import { WinBackService } from "../shared/subscriptions/win-back.service";
import { runClaimedJob } from "./operational-job-claim";

export type RuntimeSchedulers = {
  stop(): void;
};

const SIX_HOURS = 6 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export function startSubscriptionSchedulers(): RuntimeSchedulers {
  const timers: NodeJS.Timeout[] = [];

  const sweepExpiredSubscriptions = async () => {
    await runClaimedJob("subscription-expiry", SIX_HOURS, async () => {
      const result = await pool.query(`
        UPDATE subscriptions
        SET status = 'EXPIRED', updated_at = now()
        WHERE status IN ('ACTIVE', 'GRACE', 'PAST_DUE')
          AND next_billing_date IS NOT NULL
          AND next_billing_date < now()
        RETURNING id, user_id, type, artist_id
      `);

      for (const row of result.rows) {
        await WinBackService.processChurnedUser(
          row.id,
          row.user_id,
          row.type,
          row.artist_id
        ).catch((error) =>
          logger.error({ error, subscriptionId: row.id }, "[WinBack] Failed")
        );
      }
      logger.info({ updated: result.rowCount ?? 0 }, "[Sweeper] Subscription expiry sweep completed");
    });
  };

  const notifyExpiringSubscriptions = async () => {
    await runClaimedJob("subscription-expiry-notification", ONE_HOUR, async () => {
      const result = await pool.query(`
        SELECT s.user_id, s.artist_id, u.name AS artist_name
        FROM subscriptions s
        LEFT JOIN users u ON u.id = s.artist_id
        WHERE s.type = 'ARTIST'
          AND s.status = 'ACTIVE'
          AND s.next_billing_date > now() + interval '47 hours'
          AND s.next_billing_date <= now() + interval '48 hours'
      `);

      for (const row of result.rows) {
        await NotificationService.sendToUser({
          userId: String(row.user_id),
          title: "Subscription Expiring Soon! ⏳",
          body: `Your subscription to ${row.artist_name || "your artist"} will expire in 2 days.`,
          data: { type: "expiry_warning", artistId: row.artist_id },
        }).catch((error) =>
          logger.error({ error, userId: row.user_id }, "[Notifier] Expiry warning failed")
        );
      }
      logger.info({ attempted: result.rowCount ?? 0 }, "[Notifier] Expiry notification scan completed");
    });
  };

  const sweepStaleUserSessions = async () => {
    await runClaimedJob("stale-user-session-cleanup", ONE_DAY, async () => {
      const result = await pool.query(`
        DELETE FROM user_sessions
        WHERE last_active_at < now() - interval '30 days'
      `);
      logger.info({ deleted: result.rowCount ?? 0 }, "[Sweeper] Stale user session cleanup completed");
    });
  };

  const sweepStalePlaybackSessions = async () => {
    await runClaimedJob("stale-playback-session-cleanup", ONE_DAY, async () => {
      const result = await pool.query(`
        DELETE FROM playback_sessions
        WHERE (ended_at IS NOT NULL AND ended_at < now() - interval '24 hours')
           OR (ended_at IS NULL AND heartbeat_at < now() - interval '24 hours')
      `);
      logger.info({ deleted: result.rowCount ?? 0 }, "[Sweeper] Stale playback session cleanup completed");
    });
  };

  const guarded = (label: string, task: () => Promise<void>) => {
    void task().catch((error) => logger.error({ error, label }, "[Scheduler] Job failed"));
  };

  guarded("subscription-expiry", sweepExpiredSubscriptions);
  guarded("subscription-expiry-notification", notifyExpiringSubscriptions);
  guarded("stale-user-session-cleanup", sweepStaleUserSessions);
  guarded("stale-playback-session-cleanup", sweepStalePlaybackSessions);

  timers.push(setInterval(() => guarded("subscription-expiry", sweepExpiredSubscriptions), SIX_HOURS));
  timers.push(setInterval(() => guarded("subscription-expiry-notification", notifyExpiringSubscriptions), ONE_HOUR));
  timers.push(setInterval(() => guarded("stale-user-session-cleanup", sweepStaleUserSessions), ONE_DAY));
  timers.push(setInterval(() => guarded("stale-playback-session-cleanup", sweepStalePlaybackSessions), ONE_DAY));

  return {
    stop() {
      timers.forEach((timer) => clearInterval(timer));
    },
  };
}
