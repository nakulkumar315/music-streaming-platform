import { pool } from "../../common/db";

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Canonical Phase-1 paid-content entitlement.
 *
 * Access exists only when the authenticated user has an ACTIVE ARTIST
 * subscription for the content owner and the fixed access period has not
 * expired. There is intentionally no platform-plan, grace-state or feature-flag
 * bypass here.
 */
export async function hasActiveArtistEntitlement(
  rawUserId: unknown,
  rawArtistId: unknown
): Promise<boolean> {
  const userId = positiveInteger(rawUserId);
  const artistId = positiveInteger(rawArtistId);
  if (!userId || !artistId) return false;

  const result = await pool.query(
    `SELECT 1
       FROM subscriptions
      WHERE user_id = $1
        AND artist_id = $2
        AND type = 'ARTIST'
        AND status = 'ACTIVE'
        AND next_billing_date IS NOT NULL
        AND next_billing_date > now()
      LIMIT 1`,
    [userId, artistId]
  );

  return result.rowCount === 1;
}
