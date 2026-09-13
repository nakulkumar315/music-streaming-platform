import { pool } from "../common/db";
import { logger } from "../common/logger";
import { NotificationService } from "../shared/notifications/notification.service";
import { WinBackService } from "../shared/subscriptions/win-back.service";

export type RuntimeSchedulers = {
  stop(): void;
};

export function startSubscriptionSchedulers(): RuntimeSchedulers {
  const timers: NodeJS.Timeout[] = [];

  const sweepExpiredSubscriptions = async () => {
    try {
      const result = await pool.query(`
        UPDATE subscriptions
        SET status = 'EXPIRED', updated_at = now()
        WHERE status IN ('ACTIVE', 'GRACE', 'PAST_DUE')
          AND next_billing_date IS NOT NULL
          AND next_billing_date < now()
        RETURNING id, user_id, type, artist_id
      `);

      for (const row of result.rows) {
        WinBackService.processChurnedUser(
          row.id,
          row.user_id,
          row.type,
          row.artist_id
        ).catch((error) =>
          logger.error({ error, subscriptionId: row.id }, "[WinBack] Failed")
        );
      }
    } catch (error) {
      logger.error({ error }, "[Sweeper] Subscription expiry sweep failed");
    }
  };

  const notifyExpiringSubscriptions = async () => {
    try {
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
        NotificationService.sendToUser({
          userId: String(row.user_id),
          title: "Subscription Expiring Soon! ⏳",
          body: `Your subscription to ${row.artist_name || "your artist"} will expire in 2 days.`,
          data: { type: "expiry_warning", artistId: row.artist_id },
        }).catch((error) =>
          logger.error({ error, userId: row.user_id }, "[Notifier] Expiry warning failed")
        );
      }
    } catch (error) {
      logger.error({ error }, "[Notifier] Expiry notification scan failed");
    }
  };

  const sweepStaleSessions = async () => {
    try {
      await pool.query(`
        DELETE FROM user_sessions
        WHERE last_active_at < now() - interval '30 days'
      `);
    } catch (error) {
      logger.error({ error }, "[Sweeper] Stale session cleanup failed");
    }
  };

  void sweepExpiredSubscriptions();
  void notifyExpiringSubscriptions();
  void sweepStaleSessions();

  timers.push(setInterval(() => void sweepExpiredSubscriptions(), 6 * 60 * 60 * 1000));
  timers.push(setInterval(() => void notifyExpiringSubscriptions(), 60 * 60 * 1000));
  timers.push(setInterval(() => void sweepStaleSessions(), 24 * 60 * 60 * 1000));

  return {
    stop() {
      timers.forEach((timer) => clearInterval(timer));
    },
  };
}
