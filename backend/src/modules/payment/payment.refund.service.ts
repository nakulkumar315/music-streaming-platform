import { PoolClient } from "pg";
import {
  PaymentDomainError,
  RefundResult,
  writeSubscriptionAudit,
} from "./payment.service";

/**
 * Applies a verified Razorpay refund event to local state.
 *
 * The payment row is locked first, which serializes multiple refund events for
 * the same payment. Prior refund amounts are derived from the append-only
 * subscription audit ledger so several partial refunds correctly revoke access
 * once their cumulative total reaches the original payment amount.
 */
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
    !Number.isSafeInteger(paymentAmountPaise) ||
    paymentAmountPaise <= 0 ||
    !Number.isSafeInteger(refundAmountPaise) ||
    refundAmountPaise <= 0
  ) {
    throw new PaymentDomainError(
      400,
      "INVALID_REFUND_AMOUNT",
      "Refund amount is invalid"
    );
  }

  const priorResult = await client.query(
    `SELECT COALESCE(
              SUM(
                CASE
                  WHEN metadata->>'refund_amount_paise' ~ '^[0-9]+$'
                  THEN (metadata->>'refund_amount_paise')::BIGINT
                  ELSE 0
                END
              ),
              0
            ) AS refunded_amount
     FROM subscription_audit_logs
     WHERE subscription_id = $1
       AND event_type IN ('REFUND_SUCCESS', 'PARTIAL_REFUND_SUCCESS')
       AND metadata->>'payment_id' = $2`,
    [payment.subscription_id, input.paymentId]
  );

  const previouslyRefundedPaise = Number(
    priorResult.rows?.[0]?.refunded_amount ?? 0
  );
  const cumulativeRefundPaise = previouslyRefundedPaise + refundAmountPaise;

  if (
    !Number.isSafeInteger(previouslyRefundedPaise) ||
    previouslyRefundedPaise < 0 ||
    !Number.isSafeInteger(cumulativeRefundPaise) ||
    cumulativeRefundPaise > paymentAmountPaise
  ) {
    throw new PaymentDomainError(
      409,
      "REFUND_AMOUNT_MISMATCH",
      "Cumulative refund amount exceeds the authoritative payment amount"
    );
  }

  const fullRefund = cumulativeRefundPaise === paymentAmountPaise;

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
      cumulative_refund_amount_paise: cumulativeRefundPaise,
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
