import type { PoolClient } from "pg";
import {
  PaymentDomainError,
  type RefundResult,
  writeSubscriptionAudit,
} from "./payment.service";
import { finalizeRefund } from "./payment.refund.service";

export type VerifiedProviderRefundEvent = {
  paymentId: string;
  refundId: string;
  refundAmountPaise: number;
  providerStatus: string;
  currency?: string;
};

async function quarantineUnsupportedProviderRefund(
  client: PoolClient,
  input: VerifiedProviderRefundEvent,
  payment: any
): Promise<RefundResult> {
  const authoritativeAmount = Number(payment.amount);
  const observedAmount = Number(input.refundAmountPaise);
  const providerStatus = String(input.providerStatus || "unknown").toLowerCase();

  const current = await client.query(
    `SELECT *
       FROM refund_requests
      WHERE payment_id = $1
      FOR UPDATE`,
    [payment.id]
  );
  const existing = current.rows?.[0];
  const idempotencyKey = `full-refund:${String(payment.id)}`;
  const snapshot = {
    anomaly: "UNSUPPORTED_PARTIAL_REFUND_DETECTED",
    refund_id: input.refundId,
    payment_id: input.paymentId,
    observed_amount_paise: observedAmount,
    authoritative_amount_paise: authoritativeAmount,
    currency: String(input.currency || payment.currency || "INR").toUpperCase(),
    provider_status: providerStatus,
  };

  if (existing) {
    const existingProviderRefundId = existing.provider_refund_id
      ? String(existing.provider_refund_id)
      : null;

    await client.query(
      `UPDATE refund_requests
          SET status = CASE
                WHEN status = 'COMPLETED' THEN status
                ELSE 'RECONCILIATION_REQUIRED'
              END,
              provider_refund_id = COALESCE(provider_refund_id, $2),
              provider_status = $3,
              provider_snapshot = $4,
              failure_code = 'UNSUPPORTED_PARTIAL_REFUND_DETECTED',
              failure_message = 'Provider reported a partial refund outside the approved Phase 1 policy',
              last_reconciled_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [
        existing.id,
        existingProviderRefundId && existingProviderRefundId !== input.refundId
          ? null
          : input.refundId,
        providerStatus,
        snapshot,
      ]
    );
  } else {
    await client.query(
      `INSERT INTO refund_requests (
         payment_id, subscription_id, user_id, razorpay_payment_id,
         idempotency_key, amount, currency, status,
         provider_refund_id, provider_status,
         requested_by, requested_by_role,
         failure_code, failure_message, provider_snapshot,
         last_reconciled_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, 'RECONCILIATION_REQUIRED',
         $8, $9,
         NULL, 'SYSTEM',
         'UNSUPPORTED_PARTIAL_REFUND_DETECTED',
         'Provider reported a partial refund outside the approved Phase 1 policy',
         $10, now(), now(), now()
       )`,
      [
        payment.id,
        payment.subscription_id,
        payment.user_id,
        payment.razorpay_payment_id,
        idempotencyKey,
        authoritativeAmount,
        String(payment.currency || "INR").toUpperCase(),
        input.refundId,
        providerStatus,
        snapshot,
      ]
    );
  }

  await writeSubscriptionAudit(
    client,
    Number(payment.user_id),
    Number(payment.subscription_id),
    "REFUND_RECONCILIATION_REQUIRED",
    {
      payment_id: input.paymentId,
      refund_id: input.refundId,
      failure_code: "UNSUPPORTED_PARTIAL_REFUND_DETECTED",
      observed_refund_amount_paise: observedAmount,
      authoritative_payment_amount_paise: authoritativeAmount,
      provider_status: providerStatus,
      entitlement_changed: false,
    }
  );

  return {
    subscriptionId: Number(payment.subscription_id),
    userId: Number(payment.user_id),
    artistId: Number(payment.artist_id),
    fullRefund: false,
    paymentAmountPaise: authoritativeAmount,
    refundAmountPaise: observedAmount,
  };
}

/**
 * Canonical entry for verified refund webhooks.
 *
 * The product API remains full-refund-only. If Razorpay reports a partial
 * refund created outside the application, record it as a durable anomaly and
 * acknowledge the webhook without silently revoking entitlement or pretending
 * the partial refund is an approved product workflow.
 */
export async function processVerifiedRefundEvent(
  client: PoolClient,
  input: VerifiedProviderRefundEvent
): Promise<RefundResult> {
  const paymentResult = await client.query(
    `SELECT p.id, p.user_id, p.subscription_id, p.amount, p.status,
            p.razorpay_payment_id,
            s.artist_id,
            COALESCE(t.currency, 'INR') AS currency
       FROM payments p
       JOIN subscriptions s ON s.id = p.subscription_id
       LEFT JOIN transactions t
         ON t.razorpay_payment_id = p.razorpay_payment_id
      WHERE p.razorpay_payment_id = $1
      LIMIT 1
      FOR UPDATE OF p, s`,
    [input.paymentId]
  );
  const payment = paymentResult.rows?.[0];
  if (!payment) {
    throw new PaymentDomainError(
      404,
      "PAYMENT_NOT_FOUND",
      "Refund references an unknown payment"
    );
  }

  const authoritativeAmount = Number(payment.amount);
  if (!Number.isSafeInteger(authoritativeAmount) || authoritativeAmount <= 0) {
    throw new PaymentDomainError(
      500,
      "INVALID_CAPTURED_AMOUNT",
      "Captured payment amount is invalid"
    );
  }

  const observedAmount = Number(input.refundAmountPaise);
  if (!Number.isSafeInteger(observedAmount) || observedAmount <= 0) {
    throw new PaymentDomainError(
      400,
      "INVALID_REFUND_AMOUNT",
      "Provider refund amount is invalid"
    );
  }

  if (observedAmount !== authoritativeAmount) {
    return quarantineUnsupportedProviderRefund(client, input, payment);
  }

  return finalizeRefund(client, {
    paymentId: input.paymentId,
    refundId: input.refundId,
    refundAmountPaise: observedAmount,
    providerStatus: input.providerStatus,
  });
}
