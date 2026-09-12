import { PoolClient } from "pg";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../../common/db";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export class PaymentDomainError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "PaymentDomainError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type ArtistSubscriptionIntent = {
  artistId: number;
  artistName: string;
  amountPaise: number;
  currency: "INR";
};

export type GatewayOrder = {
  id: string;
  amount: number | string;
  currency: string;
};

export type PendingPurchase = {
  subscriptionId: number;
  orderId: string;
  amountPaise: number;
  currency: string;
  artistId: number;
  artistName: string;
  reused: boolean;
};

export type LocalTransaction = {
  id: number | string;
  user_id: number | string;
  razorpay_order_id: string;
  amount: number | string;
  currency: string | null;
  status: string | null;
  artist_id: number | string | null;
  artist_name?: string | null;
  razorpay_payment_id?: string | null;
};

export type CapturedPaymentResult = {
  subscriptionId: number;
  userId: number;
  artistId: number;
  artistName: string;
  amountPaise: number;
  currency: string;
  alreadyProcessed: boolean;
};

export type RefundResult = {
  subscriptionId: number;
  userId: number;
  artistId: number;
  fullRefund: boolean;
  paymentAmountPaise: number;
  refundAmountPaise: number;
};

export function rupeesToPaise(value: unknown, fieldName = "price"): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new PaymentDomainError(
      409,
      "SUBSCRIPTION_PRICE_NOT_CONFIGURED",
      `${fieldName} must be configured as a positive amount before subscriptions can be sold`
    );
  }

  const paise = Math.round(numeric * 100);
  if (!Number.isSafeInteger(paise) || paise <= 0) {
    throw new PaymentDomainError(
      500,
      "INVALID_PRICE_CONFIGURATION",
      `${fieldName} is outside the supported range`
    );
  }
  return paise;
}

function normalizeArtistId(rawArtistId: unknown): number {
  const artistId = Number(String(rawArtistId ?? "").trim());
  if (!Number.isSafeInteger(artistId) || artistId <= 0) {
    throw new PaymentDomainError(
      400,
      "INVALID_ARTIST_ID",
      "artistId must be a positive integer"
    );
  }
  return artistId;
}

export async function resolveArtistSubscriptionIntent(
  rawArtistId: unknown
): Promise<ArtistSubscriptionIntent> {
  const artistId = normalizeArtistId(rawArtistId);

  const result = await pool.query(
    `SELECT id, name, subscription_price, status, artist_status
     FROM users
     WHERE id = $1 AND UPPER(role) = 'ARTIST'
     LIMIT 1`,
    [artistId]
  );
  const artist = result.rows?.[0];

  if (!artist) {
    throw new PaymentDomainError(404, "ARTIST_NOT_FOUND", "Artist not found");
  }
  if (String(artist.status || "").toUpperCase() !== "ACTIVE") {
    throw new PaymentDomainError(
      409,
      "ARTIST_NOT_ACTIVE",
      "This artist is not currently available for subscriptions"
    );
  }
  if (String(artist.artist_status || "").toUpperCase() !== "APPROVED") {
    throw new PaymentDomainError(
      409,
      "ARTIST_NOT_APPROVED",
      "This artist is not approved for subscriptions"
    );
  }

  return {
    artistId,
    artistName: String(artist.name || `Artist ${artistId}`),
    amountPaise: rupeesToPaise(
      artist.subscription_price,
      "Artist monthly subscription price"
    ),
    currency: "INR",
  };
}

async function lockPurchaseKey(
  client: PoolClient,
  userId: number,
  artistId: number
): Promise<void> {
  // Transaction-scoped lock prevents two simultaneous checkout requests for the
  // same fan/artist from creating competing local purchases.
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

async function findReusablePendingPurchase(
  client: PoolClient,
  userId: number,
  artistId: number
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
    [userId, artistId]
  );
  const row = result.rows?.[0];
  if (!row) return null;

  return {
    subscriptionId: Number(row.subscription_id),
    orderId: String(row.razorpay_order_id),
    amountPaise: Number(row.amount),
    currency: String(row.currency || "INR").toUpperCase(),
    artistId,
    artistName: String(row.artist_name || `Artist ${artistId}`),
    reused: true,
  };
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

export async function writeSubscriptionAudit(
  client: PoolClient,
  userId: number,
  subscriptionId: number | null,
  eventType: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await client.query(
    `INSERT INTO subscription_audit_logs
       (user_id, subscription_id, event_type, metadata, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [userId, subscriptionId, eventType, metadata]
  );
}

/**
 * Start or reuse the one canonical Phase-1 artist subscription checkout.
 * Gateway order creation runs while a fan+artist advisory lock is held so two
 * concurrent requests cannot both become the current local purchase.
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
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockPurchaseKey(client, userId, intent.artistId);

    const current = await findCurrentSubscription(
      client,
      userId,
      intent.artistId
    );

    if (current) {
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

    const reusable = await findReusablePendingPurchase(
      client,
      userId,
      intent.artistId
    );
    if (reusable) {
      if (
        reusable.amountPaise !== intent.amountPaise ||
        reusable.currency !== intent.currency
      ) {
        // Pricing changed after the prior order was created. Do not silently
        // reuse an order for an obsolete amount.
        await client.query(
          `UPDATE transactions
           SET status = 'SUPERSEDED', updated_at = now()
           WHERE razorpay_order_id = $1
             AND UPPER(COALESCE(status, '')) = 'PENDING'`,
          [reusable.orderId]
        );
      } else {
        await client.query("COMMIT");
        return reusable;
      }
    }

    const order = await createGatewayOrder(intent);
    const gatewayAmount = Number(order.amount);
    const gatewayCurrency = String(order.currency || "").toUpperCase();

    if (
      !order.id ||
      !Number.isSafeInteger(gatewayAmount) ||
      gatewayAmount !== intent.amountPaise ||
      gatewayCurrency !== intent.currency
    ) {
      throw new Error("Gateway order does not match authoritative subscription price");
    }

    const subscriptionId = await upsertPendingSubscription(
      client,
      userId,
      intent.artistId
    );

    await client.query(
      `INSERT INTO transactions
         (user_id, razorpay_order_id, amount, currency, status,
          artist_name, billing_cycle, artist_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'PENDING', $5, 'monthly', $6, now(), now())`,
      [
        userId,
        order.id,
        intent.amountPaise,
        intent.currency,
        intent.artistName,
        intent.artistId,
      ]
    );

    await writeSubscriptionAudit(
      client,
      userId,
      subscriptionId,
      "SUBSCRIPTION_PURCHASE_STARTED",
      {
        order_id: order.id,
        artist_id: intent.artistId,
        amount_paise: intent.amountPaise,
        currency: intent.currency,
      }
    );

    await client.query("COMMIT");

    return {
      subscriptionId,
      orderId: order.id,
      amountPaise: intent.amountPaise,
      currency: intent.currency,
      artistId: intent.artistId,
      artistName: intent.artistName,
      reused: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function findSubscriptionForTransaction(
  client: PoolClient,
  tx: LocalTransaction
) {
  const artistId = Number(tx.artist_id);
  if (!Number.isSafeInteger(artistId) || artistId <= 0) {
    throw new Error("Payment transaction has no valid artist reference");
  }

  const result = await client.query(
    `SELECT id, user_id, artist_id, status, next_billing_date
     FROM subscriptions
     WHERE user_id = $1 AND artist_id = $2 AND type = 'ARTIST'
     LIMIT 1
     FOR UPDATE`,
    [Number(tx.user_id), artistId]
  );
  const subscription = result.rows?.[0];
  if (!subscription) {
    throw new Error("Payment transaction has no corresponding subscription");
  }
  return subscription;
}

export async function finalizeCapturedPayment(
  client: PoolClient,
  input: {
    orderId: string;
    paymentId: string;
    providerAmountPaise: number;
    providerCurrency: string;
    confirmedAt?: Date;
  }
): Promise<CapturedPaymentResult> {
  const txResult = await client.query(
    `SELECT id, user_id, razorpay_order_id, amount, currency, status,
            artist_id, artist_name, razorpay_payment_id
     FROM transactions
     WHERE razorpay_order_id = $1
     LIMIT 1
     FOR UPDATE`,
    [input.orderId]
  );
  const tx = txResult.rows?.[0] as LocalTransaction | undefined;
  if (!tx) {
    throw new PaymentDomainError(
      404,
      "TRANSACTION_NOT_FOUND",
      "No local transaction exists for this gateway order"
    );
  }

  const expectedAmount = Number(tx.amount);
  const expectedCurrency = String(tx.currency || "INR").toUpperCase();
  const providerCurrency = String(input.providerCurrency || "").toUpperCase();

  if (
    !Number.isSafeInteger(expectedAmount) ||
    expectedAmount <= 0 ||
    !Number.isSafeInteger(input.providerAmountPaise) ||
    input.providerAmountPaise !== expectedAmount ||
    providerCurrency !== expectedCurrency
  ) {
    throw new PaymentDomainError(
      409,
      "PAYMENT_AMOUNT_MISMATCH",
      "Gateway payment does not match the authoritative order"
    );
  }

  const subscription = await findSubscriptionForTransaction(client, tx);
  const userId = Number(tx.user_id);
  const artistId = Number(tx.artist_id);
  const txStatus = String(tx.status || "").toUpperCase();
  const existingPaymentId = String(tx.razorpay_payment_id || "").trim();

  if (txStatus === "SUCCESS") {
    if (existingPaymentId && existingPaymentId !== input.paymentId) {
      throw new PaymentDomainError(
        409,
        "ORDER_ALREADY_PAID",
        "This order was already paid with a different payment"
      );
    }

    return {
      subscriptionId: Number(subscription.id),
      userId,
      artistId,
      artistName: String(tx.artist_name || `Artist ${artistId}`),
      amountPaise: expectedAmount,
      currency: expectedCurrency,
      alreadyProcessed: true,
    };
  }

  if (!["PENDING", "FAILED"].includes(txStatus)) {
    throw new PaymentDomainError(
      409,
      "INVALID_PAYMENT_STATE",
      `Payment cannot be captured from state ${txStatus || "UNKNOWN"}`
    );
  }

  const existingPaymentResult = await client.query(
    `SELECT id, user_id, subscription_id, amount
     FROM payments
     WHERE razorpay_payment_id = $1
     LIMIT 1
     FOR UPDATE`,
    [input.paymentId]
  );
  const existingPayment = existingPaymentResult.rows?.[0];

  if (existingPayment) {
    if (
      Number(existingPayment.user_id) !== userId ||
      Number(existingPayment.subscription_id) !== Number(subscription.id) ||
      Number(existingPayment.amount) !== expectedAmount
    ) {
      throw new PaymentDomainError(
        409,
        "PAYMENT_ID_CONFLICT",
        "Gateway payment is already linked to a different purchase"
      );
    }
  } else {
    await client.query(
      `INSERT INTO payments
         (id, user_id, subscription_id, amount, status,
          razorpay_payment_id, created_at)
       VALUES ($1, $2, $3, $4, 'SUCCESS', $5, now())`,
      [uuidv4(), userId, subscription.id, expectedAmount, input.paymentId]
    );
  }

  const confirmedAt = input.confirmedAt ?? new Date();
  const expiresAt = new Date(confirmedAt.getTime() + MONTH_MS);

  await client.query(
    `UPDATE subscriptions
     SET status = 'ACTIVE',
         plan_type = 'MONTHLY',
         start_date = $2,
         next_billing_date = $3,
         auto_renew = false,
         updated_at = now()
     WHERE id = $1`,
    [subscription.id, confirmedAt, expiresAt]
  );

  await client.query(
    `UPDATE transactions
     SET status = 'SUCCESS',
         payment_confirmed_at = $2,
         razorpay_payment_id = $3,
         updated_at = now()
     WHERE razorpay_order_id = $1`,
    [input.orderId, confirmedAt, input.paymentId]
  );

  await writeSubscriptionAudit(
    client,
    userId,
    Number(subscription.id),
    "PAYMENT_SUCCESS",
    {
      order_id: input.orderId,
      payment_id: input.paymentId,
      artist_id: artistId,
      amount_paise: expectedAmount,
      currency: expectedCurrency,
      expires_at: expiresAt.toISOString(),
    }
  );

  return {
    subscriptionId: Number(subscription.id),
    userId,
    artistId,
    artistName: String(tx.artist_name || `Artist ${artistId}`),
    amountPaise: expectedAmount,
    currency: expectedCurrency,
    alreadyProcessed: false,
  };
}

export async function markPaymentFailed(
  client: PoolClient,
  input: {
    orderId: string;
    paymentId?: string;
    reason?: string;
  }
): Promise<void> {
  const result = await client.query(
    `UPDATE transactions
     SET status = 'FAILED',
         failure_reason = $2,
         razorpay_payment_id = COALESCE($3, razorpay_payment_id),
         updated_at = now()
     WHERE razorpay_order_id = $1
       AND UPPER(COALESCE(status, '')) = 'PENDING'
     RETURNING user_id, artist_id`,
    [
      input.orderId,
      String(input.reason || "Gateway payment failed").slice(0, 500),
      input.paymentId || null,
    ]
  );

  const row = result.rows?.[0];
  if (!row) return;

  const subscription = await client.query(
    `SELECT id FROM subscriptions
     WHERE user_id = $1 AND artist_id = $2 AND type = 'ARTIST'
     LIMIT 1`,
    [row.user_id, row.artist_id]
  );
  const subscriptionId = Number(subscription.rows?.[0]?.id || 0) || null;

  await writeSubscriptionAudit(
    client,
    Number(row.user_id),
    subscriptionId,
    "PAYMENT_FAILED",
    {
      order_id: input.orderId,
      payment_id: input.paymentId || null,
      reason: String(input.reason || "Gateway payment failed").slice(0, 500),
    }
  );
}

export async function finalizeRefund(
  client: PoolClient,
  input: {
    paymentId: string;
    refundId?: string;
    refundAmountPaise: number;
  }
): Promise<RefundResult> {
  const result = await client.query(
    `SELECT p.id, p.user_id, p.subscription_id, p.amount,
            s.artist_id
     FROM payments p
     JOIN subscriptions s ON s.id = p.subscription_id
     WHERE p.razorpay_payment_id = $1
     LIMIT 1
     FOR UPDATE OF p, s`,
    [input.paymentId]
  );
  const payment = result.rows?.[0];
  if (!payment) {
    throw new PaymentDomainError(
      404,
      "PAYMENT_NOT_FOUND",
      "Refund references an unknown payment"
    );
  }

  const paymentAmountPaise = Number(payment.amount);
  const refundAmountPaise = Number(input.refundAmountPaise);
  if (
    !Number.isSafeInteger(refundAmountPaise) ||
    refundAmountPaise <= 0 ||
    refundAmountPaise > paymentAmountPaise
  ) {
    throw new PaymentDomainError(
      400,
      "INVALID_REFUND_AMOUNT",
      "Refund amount is invalid"
    );
  }

  const fullRefund = refundAmountPaise === paymentAmountPaise;

  await client.query(
    `UPDATE payments
     SET status = $2
     WHERE id = $1`,
    [payment.id, fullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED"]
  );

  if (fullRefund) {
    await client.query(
      `UPDATE subscriptions
       SET status = 'CANCELLED',
           next_billing_date = now(),
           auto_renew = false,
           updated_at = now()
       WHERE id = $1`,
      [payment.subscription_id]
    );

    await client.query(
      `UPDATE transactions
       SET status = 'REFUNDED', updated_at = now()
       WHERE razorpay_payment_id = $1`,
      [input.paymentId]
    );
  }

  await writeSubscriptionAudit(
    client,
    Number(payment.user_id),
    Number(payment.subscription_id),
    fullRefund ? "REFUND_SUCCESS" : "PARTIAL_REFUND_SUCCESS",
    {
      payment_id: input.paymentId,
      refund_id: input.refundId || null,
      refund_amount_paise: refundAmountPaise,
      payment_amount_paise: paymentAmountPaise,
    }
  );

  return {
    subscriptionId: Number(payment.subscription_id),
    userId: Number(payment.user_id),
    artistId: Number(payment.artist_id),
    fullRefund,
    paymentAmountPaise,
    refundAmountPaise,
  };
}
