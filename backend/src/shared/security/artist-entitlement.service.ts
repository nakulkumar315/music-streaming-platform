import { pool } from "../../common/db";

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export type ArtistEntitlementState = "ACTIVE" | "EXPIRED" | "INACTIVE" | "MISSING";

/**
 * Returns the latest artist-subscription state needed by playback authorization.
 * This preserves enough information for the API to distinguish a first-time
 * subscription requirement from an expired/inactive subscription without
 * trusting any client-side state.
 */
export async function getArtistEntitlementState(
  rawUserId: unknown,
  rawArtistId: unknown
): Promise<ArtistEntitlementState> {
  const userId = positiveInteger(rawUserId);
  const artistId = positiveInteger(rawArtistId);
  if (!userId || !artistId) return "MISSING";

  const result = await pool.query<{
    status: string | null;
    next_billing_date: Date | string | null;
  }>(
    `SELECT s.status, s.next_billing_date
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1
        AND s.artist_id = $2
        AND s.type = 'ARTIST'
        AND UPPER(COALESCE(u.status, '')) = 'ACTIVE'
        AND COALESCE(u.is_deleted, false) = false
      ORDER BY s.updated_at DESC NULLS LAST, s.id DESC
      LIMIT 1`,
    [userId, artistId]
  );

  const row = result.rows[0];
  if (!row) return "MISSING";

  const status = String(row.status || "").toUpperCase();
  const expiry = row.next_billing_date ? new Date(row.next_billing_date) : null;
  const expiryMs = expiry && !Number.isNaN(expiry.getTime()) ? expiry.getTime() : null;

  if (status === "ACTIVE" && expiryMs !== null && expiryMs > Date.now()) {
    return "ACTIVE";
  }

  if (status === "EXPIRED" || (expiryMs !== null && expiryMs <= Date.now())) {
    return "EXPIRED";
  }

  return "INACTIVE";
}

/**
 * Canonical Phase-1 paid-content entitlement boolean retained for existing
 * callers. New playback code should use getArtistEntitlementState when it needs
 * a stable denial reason for UI/API behavior.
 */
export async function hasActiveArtistEntitlement(
  rawUserId: unknown,
  rawArtistId: unknown
): Promise<boolean> {
  return (await getArtistEntitlementState(rawUserId, rawArtistId)) === "ACTIVE";
}
