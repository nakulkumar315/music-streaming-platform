import { pool } from "../../common/db";
import {
  RefundGateway,
  razorpayRefundGateway,
} from "./payment.refund.gateway";
import { finalizeRefund } from "./payment.refund.service";

export type RefundDriftOutcome = {
  paymentId: string;
  gatewayPaymentId: string;
  status:
    | "NO_PROVIDER_REFUND"
    | "CORRECTED_FULL_REFUND"
    | "PARTIAL_REFUND_DETECTED"
    | "FULL_REFUND_REFERENCE_UNRESOLVED"
    | "RECONCILIATION_ERROR";
  providerAmountRefundedPaise?: number;
  refundId?: string;
  error?: string;
};

/**
 * Detects provider-side refunds for locally captured payments that have no
 * refund_requests row. This repairs the missed-webhook / provider-dashboard
 * case without creating a second gateway operation.
 *
 * Phase 1 supports one full refund operation. Provider-side partial refunds are
 * deliberately surfaced as anomalies and are never silently normalized into a
 * supported local refund flow.
 */
export async function reconcileProviderRefundDrift(
  gateway: RefundGateway = razorpayRefundGateway,
  limit = 25
): Promise<RefundDriftOutcome[]> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
  const candidates = await pool.query(
    `SELECT p.id,
            p.razorpay_payment_id,
            p.amount,
            COALESCE(t.currency, 'INR') AS currency
       FROM payments p
       LEFT JOIN transactions t
         ON t.razorpay_payment_id = p.razorpay_payment_id
       LEFT JOIN refund_requests r
         ON r.payment_id = p.id
      WHERE UPPER(p.status) = 'SUCCESS'
        AND r.id IS NULL
      ORDER BY p.created_at DESC
      LIMIT $1`,
    [boundedLimit]
  );

  const outcomes: RefundDriftOutcome[] = [];

  for (const row of candidates.rows) {
    const localPaymentId = String(row.id);
    const gatewayPaymentId = String(row.razorpay_payment_id);
    const authoritativeAmount = Number(row.amount);
    const currency = String(row.currency || "INR").toUpperCase();

    try {
      const providerPayment = await gateway.fetchPayment(gatewayPaymentId);
      const refunded = Number(providerPayment.amountRefundedPaise);

      if (!Number.isSafeInteger(refunded) || refunded <= 0) {
        outcomes.push({
          paymentId: localPaymentId,
          gatewayPaymentId,
          status: "NO_PROVIDER_REFUND",
          providerAmountRefundedPaise: Math.max(0, refunded || 0),
        });
        continue;
      }

      if (
        refunded < authoritativeAmount ||
        providerPayment.currency !== currency
      ) {
        outcomes.push({
          paymentId: localPaymentId,
          gatewayPaymentId,
          status: "PARTIAL_REFUND_DETECTED",
          providerAmountRefundedPaise: refunded,
        });
        continue;
      }

      const refunds = await gateway.listRefunds(gatewayPaymentId);
      const fullRefund = refunds.find(
        (refund) =>
          refund.paymentId === gatewayPaymentId &&
          refund.amountPaise === authoritativeAmount &&
          refund.currency === currency &&
          refund.status === "processed"
      );

      if (!fullRefund) {
        outcomes.push({
          paymentId: localPaymentId,
          gatewayPaymentId,
          status: "FULL_REFUND_REFERENCE_UNRESOLVED",
          providerAmountRefundedPaise: refunded,
        });
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await finalizeRefund(client, {
          paymentId: gatewayPaymentId,
          refundId: fullRefund.id,
          refundAmountPaise: fullRefund.amountPaise,
          providerStatus: fullRefund.status,
        });
        await client.query("COMMIT");

        outcomes.push({
          paymentId: localPaymentId,
          gatewayPaymentId,
          status: result.fullRefund
            ? "CORRECTED_FULL_REFUND"
            : "FULL_REFUND_REFERENCE_UNRESOLVED",
          providerAmountRefundedPaise: refunded,
          refundId: fullRefund.id,
        });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error: any) {
      outcomes.push({
        paymentId: localPaymentId,
        gatewayPaymentId,
        status: "RECONCILIATION_ERROR",
        error: String(error?.code || error?.message || "unknown"),
      });
    }
  }

  return outcomes;
}
