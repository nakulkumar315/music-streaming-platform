import { PoolClient } from "pg";
import { pool } from "../../common/db";
import {
  ArtistSubscriptionIntent,
  GatewayOrder,
  PaymentDomainError,
  PendingPurchase,
  resolveArtistSubscriptionIntent,
  writeSubscriptionAudit,
} from "./payment.service";

async function lockPurchaseKey(
  client: PoolClient,
  userId: number,
  artistId: number
): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [userId, artistId]);
}

async function findCurrentSubscription(
  client: PoolClient,
  userId: number,
  artistId: number
) {
  const result = await client.query(
    `SELECT id, status, next_billing_date
     FROM subscriptions
     WHERE user_id = $1 AND artist_id = $2 AND type = 'ARTIST'
     LIMIT 1
     FOR UPDATE`,
    [userId, artistId]
  );
  return result.rows?.[0] ?? null;
}

async function expireStaleActiveSubscription(
  client: PoolClient,
  current: any
): Promise<void> {
  if (!current) return;

  const status = String(current.status || "").toUpperCase();
  const expiry = current.next_billing_date
    ? new Date(current.next_billing_date)
    : null;

  if (status === "ACTIVE" && (!expiry || expiry.getTime() > Date.now())) {
    throw new PaymentDomainError(
      409,
      "SUBSCRIPTION_ALREADY_ACTIVE",
      "You already have an active subscription to this artist"
    );
  }

  if (status === "ACTIVE" && expiry && expiry.getTime() <= Date.now()) {
    await client.query(
      `UPDATE subscriptions
       SET status = 'EXPIRED', updated_at = now()
       WHERE id = $1`,
      [current.id]
    );
  }
}

async function findReusablePendingPurchase(
  client: PoolClient,
  userId: number,
  intent: ArtistSubscriptionIntent
): Promise<PendingPurchase | null> {
  const result = await client.query(
    `SELECT s.id AS subscription_id,
            t.razorpay_order_id,
            t.amount,
            t.currency,
            t.artist_name
     FROM subscriptions s
     JOIN transactions t
       ON t.user_id = s.user_id
      AND t.artist_id = s.artist_id
     WHERE s.user_id = $1
       AND s.artist_id = $2
       AND s.type = 'ARTIST'
       AND UPPER(COALESCE(s.status, '')) = 'PENDING'
       AND UPPER(COALESCE(t.status, '')) = 'PENDING'
     ORDER BY t.created_at DESC
     LIMIT 1
     FOR UPDATE OF s, t`,
    [userId, intent.artistId]
  );

  const row = result.rows?.[0];
  if (!row) return null;

  const amountPaise = Number(row.amount);
  const currency = String(row.currency || "INR").toUpperCase();
  if (amountPaise !== intent.amountPaise || currency !== intent.currency) {
    return null;
  }

  return {
    subscriptionId: Number(row.subscription_id),
    orderId: String(row.razorpay_order_id),
    amountPaise,
    currency,
    artistId: intent.artistId,
    artistName: String(row.artist_name || intent.artistName),
    reused: true,
  };
}

async function supersedeObsoletePendingPurchases(
  client: PoolClient,
  userId: number,
  intent: ArtistSubscriptionIntent
): Promise<void> {
  await client.query(
    `UPDATE transactions
     SET status = 'SUPERSEDED', updated_at = now()
     WHERE user_id = $1
       AND artist_id = $2
       AND UPPER(COALESCE(status, '')) = 'PENDING'
       AND (amount <> $3 OR UPPER(COALESCE(currency, 'INR')) <> $4)`,
    [userId, intent.artistId, intent.amountPaise, intent.currency]
  );
}

async function upsertPendingSubscription(
  client: PoolClient,
  userId: number,
  artistId: number
): Promise<number> {
  const result = await client.query(
    `INSERT INTO subscriptions
       (user_id, artist_id, type, status, plan_type, start_date,
        next_billing_date, auto_renew, created_at, updated_at)
     VALUES ($1, $2, 'ARTIST', 'PENDING', 'MONTHLY', now(), NULL, false, now(), now())
     ON CONFLICT (user_id, artist_id)
     DO UPDATE SET
       type = 'ARTIST',
       status = 'PENDING',
       plan_type = 'MONTHLY',
       start_date = now(),
       next_billing_date = NULL,
       auto_renew = false,
       updated_at = now()
     RETURNING id`,
    [userId, artistId]
  );

  const id = Number(result.rows?.[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Subscription persistence failed");
  }
  return id;
}

async function runLockedPreflight(
  userId: number,
  intent: ArtistSubscriptionIntent
): Promise<PendingPurchase | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockPurchaseKey(client, userId, intent.artistId);
    const current = await findCurrentSubscription(client, userId, intent.artistId);
    await expireStaleActiveSubscription(client, current);

    const reusable = await findReusablePendingPurchase(client, userId, intent);
    await client.query("COMMIT");
    return reusable;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function validateGatewayOrder(
  order: GatewayOrder,
  intent: ArtistSubscriptionIntent
): void {
  const gatewayAmount = Number(order.amount);
  const gatewayCurrency = String(order.currency || "").toUpperCase();

  if (
    !order.id ||
    !Number.isSafeInteger(gatewayAmount) ||
    gatewayAmount !== intent.amountPaise ||
    gatewayCurrency !== intent.currency
  ) {
    throw new PaymentDomainError(
      502,
      "PAYMENT_PROVIDER_ORDER_MISMATCH",
      "Payment provider returned an order that does not match the authoritative subscription price"
    );
  }
}

function assertIntentUnchanged(
  before: ArtistSubscriptionIntent,
  after: ArtistSubscriptionIntent
): void {
  if (
    before.artistId !== after.artistId ||
    before.amountPaise !== after.amountPaise ||
    before.currency !== after.currency
  ) {
    throw new PaymentDomainError(
      409,
      "SUBSCRIPTION_INTENT_CHANGED",
      "Subscription pricing or availability changed while checkout was being prepared. Please retry."
    );
  }
}

/**
 * Starts the canonical Phase-1 artist checkout without keeping a database
 * transaction or advisory lock open while Razorpay is called.
 *
 * The two short critical sections prevent duplicate local purchases. A rare
 * concurrent request can create an unused provider order, but only one local
 * order becomes authoritative; this is safer than holding database locks over
 * an external network request and is recoverable through provider reconciliation.
 */
export async function startArtistSubscriptionPurchase(
  userId: number,
  rawArtistId: unknown,
  createGatewayOrder: (
    intent: ArtistSubscriptionIntent
  ) => Promise<GatewayOrder>
): Promise<PendingPurchase> {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new PaymentDomainError(401, "UNAUTHORIZED", "Unauthorized");
  }

  const intent = await resolveArtistSubscriptionIntent(rawArtistId);
  const reusable = await runLockedPreflight(userId, intent);
  if (reusable) return reusable;

  // Deliberately outside any DB transaction/lock.
  const order = await createGatewayOrder(intent);
  validateGatewayOrder(order, intent);

  // Re-read server-authoritative artist state after the provider round trip so
  // a price/status change cannot silently persist an obsolete local purchase.
  const currentIntent = await resolveArtistSubscriptionIntent(intent.artistId);
  assertIntentUnchanged(intent, currentIntent);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockPurchaseKey(client, userId, intent.artistId);

    const current = await findCurrentSubscription(client, userId, intent.artistId);
    await expireStaleActiveSubscription(client, current);

    // Another request may have won while the provider call was in flight.
    const concurrentReusable = await findReusablePendingPurchase(
      client,
      userId,
      currentIntent
    );
    if (concurrentReusable) {
      await client.query("COMMIT");
      return concurrentReusable;
    }

    await supersedeObsoletePendingPurchases(client, userId, currentIntent);

    const subscriptionId = await upsertPendingSubscription(
      client,
      userId,
      currentIntent.artistId
    );

    await client.query(
      `INSERT INTO transactions
         (user_id, razorpay_order_id, amount, currency, status,
          artist_name, billing_cycle, artist_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'PENDING', $5, 'monthly', $6, now(), now())`,
      [
        userId,
        order.id,
        currentIntent.amountPaise,
        currentIntent.currency,
        currentIntent.artistName,
        currentIntent.artistId,
      ]
    );

    await writeSubscriptionAudit(
      client,
      userId,
      subscriptionId,
      "SUBSCRIPTION_PURCHASE_STARTED",
      {
        order_id: order.id,
        artist_id: currentIntent.artistId,
        amount_paise: currentIntent.amountPaise,
        currency: currentIntent.currency,
      }
    );

    await client.query("COMMIT");

    return {
      subscriptionId,
      orderId: order.id,
      amountPaise: currentIntent.amountPaise,
      currency: currentIntent.currency,
      artistId: currentIntent.artistId,
      artistName: currentIntent.artistName,
      reused: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
