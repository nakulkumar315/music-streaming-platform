import { pool } from "../../common/db";

export async function listPaymentsForRefundReview(limit = 50) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  const result = await pool.query(
    `SELECT p.id AS payment_id,
            p.razorpay_payment_id,
            p.user_id,
            p.subscription_id,
            p.amount,
            p.status AS payment_status,
            p.created_at AS captured_at,
            COALESCE(t.currency, 'INR') AS currency,
            t.refund_amount,
            t.refund_status,
            s.status AS subscription_status,
            s.artist_id,
            artist.name AS artist_name,
            r.id AS refund_request_id,
            r.status AS refund_request_status,
            r.provider_refund_id,
            r.provider_status,
            r.failure_code,
            r.updated_at AS refund_updated_at
       FROM payments p
       JOIN subscriptions s ON s.id = p.subscription_id
       JOIN users artist ON artist.id = s.artist_id
       LEFT JOIN transactions t ON t.razorpay_payment_id = p.razorpay_payment_id
       LEFT JOIN refund_requests r ON r.payment_id = p.id
      ORDER BY p.created_at DESC
      LIMIT $1`,
    [boundedLimit]
  );

  return result.rows.map((row: any) => ({
    paymentId: String(row.payment_id),
    gatewayPaymentId: String(row.razorpay_payment_id),
    userId: Number(row.user_id),
    subscriptionId: Number(row.subscription_id),
    artistId: Number(row.artist_id),
    artistName: String(row.artist_name || "Artist"),
    amount: Number(row.amount),
    currency: String(row.currency || "INR").toUpperCase(),
    paymentStatus: String(row.payment_status || ""),
    subscriptionStatus: String(row.subscription_status || ""),
    capturedAt: row.captured_at,
    refundAmount: Number(row.refund_amount || 0),
    refundStatus: row.refund_status ? String(row.refund_status) : null,
    refundRequest: row.refund_request_id
      ? {
          id: String(row.refund_request_id),
          status: String(row.refund_request_status),
          providerRefundId: row.provider_refund_id
            ? String(row.provider_refund_id)
            : null,
          providerStatus: row.provider_status ? String(row.provider_status) : null,
          failureCode: row.failure_code ? String(row.failure_code) : null,
          updatedAt: row.refund_updated_at,
        }
      : null,
  }));
}
