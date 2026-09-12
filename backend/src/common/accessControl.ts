import { pool } from "./db";
import { hasActiveArtistEntitlement } from "../shared/security/artist-entitlement.service";

/** Canonical Phase-1 artist entitlement check. */
export const checkAccess = async (
  userId: number,
  artistId: number
): Promise<boolean> => hasActiveArtistEntitlement(userId, artistId);

export const getSubscriptionDetails = async (
  userId: number,
  artistId: number
): Promise<SubscriptionDetails | null> => {
  const result = await pool.query(
    `SELECT id, status, plan_type, start_date, next_billing_date,
            auto_renew, created_at, updated_at
       FROM subscriptions
      WHERE user_id = $1
        AND artist_id = $2
        AND type = 'ARTIST'
      LIMIT 1`,
    [userId, artistId]
  );
  return result.rows[0] ?? null;
};

/**
 * Metadata lock state for content-list/detail APIs. Playback still performs its
 * own complete approval, visibility and live-entitlement authorization.
 */
export const checkContentAccess = async (
  userId: number | null,
  contentId: number
): Promise<{ isLocked: boolean; subscriptionRequired: boolean }> => {
  try {
    const contentResult = await pool.query(
      `SELECT artist_id, COALESCE(subscription_required, true) AS subscription_required
         FROM content_items
        WHERE id = $1
        LIMIT 1`,
      [contentId]
    );

    const content = contentResult.rows[0];
    if (!content) return { isLocked: true, subscriptionRequired: true };

    const subscriptionRequired = Boolean(content.subscription_required);
    if (!subscriptionRequired) {
      return { isLocked: false, subscriptionRequired: false };
    }
    if (!userId) return { isLocked: true, subscriptionRequired: true };

    const hasAccess = await hasActiveArtistEntitlement(userId, content.artist_id);
    return { isLocked: !hasAccess, subscriptionRequired: true };
  } catch {
    // Metadata access must also fail closed when the database is unavailable.
    return { isLocked: true, subscriptionRequired: true };
  }
};

export type SubscriptionDetails = {
  id: number;
  status: string;
  plan_type: string;
  start_date: Date;
  next_billing_date: Date;
  auto_renew: boolean;
  created_at: Date;
  updated_at: Date;
};
