import { pool } from "../../common/db";

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Canonical Phase-1 paid-content entitlement.
 *
 * Access exists only when an active, non-deleted user has an ACTIVE ARTIST
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
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1
        AND s.artist_id = $2
        AND s.type = 'ARTIST'
        AND s.status = 'ACTIVE'
        AND s.next_billing_date IS NOT NULL
        AND s.next_billing_date > now()
        AND UPPER(COALESCE(u.status, '')) = 'ACTIVE'
        AND COALESCE(u.is_deleted, false) = false
      LIMIT 1`,
    [userId, artistId]
  );

  return result.rowCount === 1;
}
