import { pool } from "../../common/db";
import { PaymentDomainError, writeSubscriptionAudit } from "../payment/payment.service";

export type CancellationResult = {
  subscriptionId: number;
  userId: number;
  artistId: number;
  status: "CANCELLED";
  alreadyCancelled: boolean;
  cancelledAt: Date;
};

/**
 * Phase-1 cancellation is an ADMIN governance action and is deliberately not a
 * refund. It revokes entitlement immediately by changing only subscription
 * state; captured payment/refund rows remain untouched.
 */
export async function cancelSubscription(
  subscriptionId: number,
  actor: { userId: number; role: "ADMIN" },
  reason?: string
): Promise<CancellationResult> {
  if (!Number.isSafeInteger(subscriptionId) || subscriptionId <= 0) {
    throw new PaymentDomainError(
      400,
      "INVALID_SUBSCRIPTION_ID",
      "Subscription id is invalid"
    );
  }
  if (!Number.isSafeInteger(actor.userId) || actor.userId <= 0 || actor.role !== "ADMIN") {
    throw new PaymentDomainError(403, "CANCELLATION_FORBIDDEN", "Admin permission is required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT id, user_id, artist_id, status, canceled_at
         FROM subscriptions
        WHERE id = $1
        LIMIT 1
        FOR UPDATE`,
      [subscriptionId]
    );
    const current = currentResult.rows?.[0];
    if (!current) {
      throw new PaymentDomainError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "Subscription not found"
      );
    }

    const status = String(current.status || "").toUpperCase();
    if (status === "CANCELLED") {
      await client.query("COMMIT");
      return {
        subscriptionId: Number(current.id),
        userId: Number(current.user_id),
        artistId: Number(current.artist_id),
        status: "CANCELLED",
        alreadyCancelled: true,
        cancelledAt: current.canceled_at ?? new Date(),
      };
    }

    if (status !== "ACTIVE") {
      throw new PaymentDomainError(
        409,
        "SUBSCRIPTION_NOT_CANCELLABLE",
        `Subscription cannot be cancelled from state ${status || "UNKNOWN"}`
      );
    }

    const updated = await client.query(
      `UPDATE subscriptions
          SET status = 'CANCELLED',
              auto_renew = false,
              canceled_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING id, user_id, artist_id, canceled_at`,
      [subscriptionId]
    );

    await writeSubscriptionAudit(
      client,
      Number(current.user_id),
      Number(current.id),
      "SUBSCRIPTION_CANCELLED",
      {
        actor_id: actor.userId,
        actor_role: actor.role,
        reason: String(reason || "").trim() || null,
        financial_refund: false,
        entitlement_revoked: true,
      }
    );

    await client.query("COMMIT");
    return {
      subscriptionId: Number(updated.rows[0].id),
      userId: Number(updated.rows[0].user_id),
      artistId: Number(updated.rows[0].artist_id),
      status: "CANCELLED",
      alreadyCancelled: false,
      cancelledAt: updated.rows[0].canceled_at,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
