import { PoolClient } from "pg";
import { pool } from "../../common/db";
import {
  PaymentDomainError,
  RefundResult,
  writeSubscriptionAudit,
} from "./payment.service";
import {
  GatewayRefund,
  RefundGateway,
  razorpayRefundGateway,
} from "./payment.refund.gateway";

export type RefundRequestStatus =
  | "REQUESTED"
  | "GATEWAY_REQUESTED"
  | "PROVIDER_PENDING"
  | "COMPLETED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED";

export type RefundActor = {
  userId: number;
  role: "ADMIN" | "FINANCE";
};

export type RefundRequest = {
  id: string;
  paymentId: string;
  subscriptionId: number;
  userId: number;
  razorpayPaymentId: string;
  idempotencyKey: string;
  amountPaise: number;
  currency: string;
  status: RefundRequestStatus;
  providerRefundId: string | null;
  providerStatus: string | null;
  requestedBy: number | null;
  requestedByRole: string;
  failureCode: string | null;
  failureMessage: string | null;
  completedAt: Date | null;
};

function isUuid(value: unknown): value is string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function mapRequest(row: any): RefundRequest {
  return {
    id: String(row.id),
    paymentId: String(row.payment_id),
    subscriptionId: Number(row.subscription_id),
    userId: Number(row.user_id),
    razorpayPaymentId: String(row.razorpay_payment_id),
    idempotencyKey: String(row.idempotency_key),
    amountPaise: Number(row.amount),
    currency: String(row.currency || "INR").toUpperCase(),
    status: String(row.status) as RefundRequestStatus,
    providerRefundId: row.provider_refund_id ? String(row.provider_refund_id) : null,
    providerStatus: row.provider_status ? String(row.provider_status) : null,
    requestedBy: row.requested_by == null ? null : Number(row.requested_by),
    requestedByRole: String(row.requested_by_role || "SYSTEM"),
    failureCode: row.failure_code ? String(row.failure_code) : null,
    failureMessage: row.failure_message ? String(row.failure_message) : null,
    completedAt: row.completed_at ?? null,
  };
}

function safeProviderSnapshot(refund: GatewayRefund) {
  return {
    id: refund.id,
    payment_id: refund.paymentId,
    amount: refund.amountPaise,
    currency: refund.currency,
    status: refund.status,
    created_at: refund.createdAt ?? null,
  };
}

async function loadPayment(
  client: PoolClient,
  input: { localPaymentId?: string; gatewayPaymentId?: string }
) {
  const column = input.localPaymentId ? "p.id" : "p.razorpay_payment_id";
  const value = input.localPaymentId ?? input.gatewayPaymentId;
  const result = await client.query(
    `SELECT p.id, p.user_id, p.subscription_id, p.amount, p.status,
            p.razorpay_payment_id, s.artist_id,
            s.status AS subscription_status,
            COALESCE(t.currency, 'INR') AS currency
       FROM payments p
       JOIN subscriptions s ON s.id = p.subscription_id
       LEFT JOIN transactions t ON t.razorpay_payment_id = p.razorpay_payment_id
      WHERE ${column} = $1
      LIMIT 1
      FOR UPDATE OF p, s`,
    [value]
  );
  const payment = result.rows?.[0];
  if (!payment) {
    throw new PaymentDomainError(404, "PAYMENT_NOT_FOUND", "Payment not found");
  }
  return payment;
}

function authoritativeAmount(payment: any) {
  const amount = Number(payment.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new PaymentDomainError(
      500,
      "INVALID_CAPTURED_AMOUNT",
      "Captured payment amount is invalid"
    );
  }
  return amount;
}

async function insertIntent(
  client: PoolClient,
  payment: any,
  actor: { userId?: number | null; role: string }
) {
  const amount = authoritativeAmount(payment);
  const idempotencyKey = `full-refund:${String(payment.id)}`;
  const inserted = await client.query(
    `INSERT INTO refund_requests (
       payment_id, subscription_id, user_id, razorpay_payment_id,
       idempotency_key, amount, currency, status,
       requested_by, requested_by_role, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'REQUESTED', $8, $9, now(), now())
     ON CONFLICT (payment_id) DO NOTHING
     RETURNING *`,
    [
      payment.id,
      payment.subscription_id,
      payment.user_id,
      payment.razorpay_payment_id,
      idempotencyKey,
      amount,
      String(payment.currency || "INR").toUpperCase(),
      actor.userId ?? null,
      actor.role,
    ]
  );

  if (inserted.rows.length) {
    await writeSubscriptionAudit(
      client,
      Number(payment.user_id),
      Number(payment.subscription_id),
      "REFUND_REQUESTED",
      {
        refund_request_id: inserted.rows[0].id,
        payment_id: payment.razorpay_payment_id,
        amount_paise: amount,
        requested_by: actor.userId ?? null,
        requested_by_role: actor.role,
      }
    );
    return inserted.rows[0];
  }

  const existing = await client.query(
    `SELECT * FROM refund_requests WHERE payment_id = $1 FOR UPDATE`,
    [payment.id]
  );
  if (!existing.rows.length) throw new Error("Refund intent persistence failed");
  return existing.rows[0];
}

export async function createOrLoadFullRefundIntent(
  localPaymentId: string,
  actor: RefundActor
): Promise<RefundRequest> {
  if (!isUuid(localPaymentId)) {
    throw new PaymentDomainError(400, "INVALID_PAYMENT_ID", "Payment id is invalid");
  }
  if (
    !Number.isSafeInteger(actor.userId) ||
    actor.userId <= 0 ||
    !["ADMIN", "FINANCE"].includes(actor.role)
  ) {
    throw new PaymentDomainError(403, "REFUND_FORBIDDEN", "Refund permission is required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const payment = await loadPayment(client, { localPaymentId });
    const existing = await client.query(
      `SELECT * FROM refund_requests WHERE payment_id = $1 FOR UPDATE`,
      [payment.id]
    );
    if (existing.rows.length) {
      await client.query("COMMIT");
      return mapRequest(existing.rows[0]);
    }

    if (String(payment.status || "").toUpperCase() !== "SUCCESS") {
      throw new PaymentDomainError(
        409,
        "PAYMENT_NOT_REFUNDABLE",
        "Only a successfully captured payment can be refunded"
      );
    }

    const intent = await insertIntent(client, payment, actor);
    await client.query("COMMIT");
    return mapRequest(intent);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function lockRequest(client: PoolClient, requestId: string) {
  const result = await client.query(
    `SELECT * FROM refund_requests WHERE id = $1 FOR UPDATE`,
    [requestId]
  );
  if (!result.rows.length) {
    throw new PaymentDomainError(404, "REFUND_REQUEST_NOT_FOUND", "Refund request not found");
  }
  return result.rows[0];
}

async function moveToGatewayRequested(requestId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await lockRequest(client, requestId);
    const current = mapRequest(row);

    if (
      current.status === "COMPLETED" ||
      current.status === "GATEWAY_REQUESTED" ||
      current.status === "PROVIDER_PENDING" ||
      current.status === "RECONCILIATION_REQUIRED"
    ) {
      await client.query("COMMIT");
      return { request: current, shouldCallGateway: false };
    }

    const updated = await client.query(
      `UPDATE refund_requests
          SET status = 'GATEWAY_REQUESTED',
              failure_code = NULL,
              failure_message = NULL,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [requestId]
    );
    await client.query("COMMIT");
    return { request: mapRequest(updated.rows[0]), shouldCallGateway: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function definiteGatewayFailure(error: any) {
  const status = Number(error?.statusCode || error?.status || error?.response?.status || 0);
  return status >= 400 && status < 500;
}

async function persistGatewayFailure(requestId: string, error: any) {
  const definite = definiteGatewayFailure(error);
  const code = String(
    error?.error?.code ||
      error?.code ||
      (definite ? "GATEWAY_REFUND_REJECTED" : "GATEWAY_REFUND_AMBIGUOUS")
  );
  const message = String(
    error?.error?.description ||
      error?.message ||
      (definite ? "Payment gateway rejected refund" : "Refund outcome requires reconciliation")
  ).slice(0, 1000);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await lockRequest(client, requestId);
    if (String(row.status) === "COMPLETED") {
      await client.query("COMMIT");
      return mapRequest(row);
    }

    const status = definite ? "FAILED" : "RECONCILIATION_REQUIRED";
    const updated = await client.query(
      `UPDATE refund_requests
          SET status = $2,
              failure_code = $3,
              failure_message = $4,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [requestId, status, code, message]
    );
    await writeSubscriptionAudit(
      client,
      Number(row.user_id),
      Number(row.subscription_id),
      definite ? "REFUND_FAILED" : "REFUND_RECONCILIATION_REQUIRED",
      { refund_request_id: requestId, failure_code: code }
    );
    await client.query("COMMIT");
    return mapRequest(updated.rows[0]);
  } catch (dbError) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw dbError;
  } finally {
    client.release();
  }
}

async function completeFullRefund(
  client: PoolClient,
  payment: any,
  requestRow: any,
  refund: GatewayRefund
): Promise<RefundResult> {
  const amount = authoritativeAmount(payment);
  const currency = String(payment.currency || "INR").toUpperCase();
  if (
    refund.paymentId !== String(payment.razorpay_payment_id) ||
    refund.amountPaise !== amount ||
    refund.currency !== currency
  ) {
    throw new PaymentDomainError(
      409,
      "REFUND_AMOUNT_MISMATCH",
      "Gateway refund does not match the authoritative full payment amount"
    );
  }

  if (String(requestRow.status) === "COMPLETED") {
    return {
      subscriptionId: Number(payment.subscription_id),
      userId: Number(payment.user_id),
      artistId: Number(payment.artist_id),
      fullRefund: true,
      paymentAmountPaise: amount,
      refundAmountPaise: amount,
    };
  }

  if (requestRow.provider_refund_id && String(requestRow.provider_refund_id) !== refund.id) {
    throw new PaymentDomainError(
      409,
      "REFUND_PROVIDER_REFERENCE_CONFLICT",
      "Payment is already associated with another refund operation"
    );
  }

  await client.query(`UPDATE payments SET status = 'REFUNDED' WHERE id = $1`, [payment.id]);
  await client.query(
    `UPDATE subscriptions
        SET status = 'CANCELLED',
            auto_renew = false,
            canceled_at = COALESCE(canceled_at, now()),
            updated_at = now()
      WHERE id = $1`,
    [payment.subscription_id]
  );
  await client.query(
    `UPDATE transactions
        SET status = 'REFUNDED',
            refund_amount = $2,
            refund_status = 'REFUNDED',
            updated_at = now()
      WHERE razorpay_payment_id = $1`,
    [payment.razorpay_payment_id, amount]
  );
  await client.query(
    `UPDATE refund_requests
        SET status = 'COMPLETED',
            provider_refund_id = $2,
            provider_status = $3,
            provider_snapshot = $4,
            failure_code = NULL,
            failure_message = NULL,
            completed_at = COALESCE(completed_at, now()),
            last_reconciled_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [requestRow.id, refund.id, refund.status, safeProviderSnapshot(refund)]
  );
  await writeSubscriptionAudit(
    client,
    Number(payment.user_id),
    Number(payment.subscription_id),
    "REFUND_SUCCESS",
    {
      refund_request_id: requestRow.id,
      payment_id: payment.razorpay_payment_id,
      refund_id: refund.id,
      refund_amount_paise: amount,
      payment_amount_paise: amount,
      entitlement_revoked: true,
    }
  );

  return {
    subscriptionId: Number(payment.subscription_id),
    userId: Number(payment.user_id),
    artistId: Number(payment.artist_id),
    fullRefund: true,
    paymentAmountPaise: amount,
    refundAmountPaise: amount,
  };
}

async function persistProviderOutcome(requestId: string, refund: GatewayRefund) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestRow = await lockRequest(client, requestId);
    const payment = await loadPayment(client, {
      gatewayPaymentId: String(requestRow.razorpay_payment_id),
    });

    if (
      refund.paymentId !== String(requestRow.razorpay_payment_id) ||
      refund.amountPaise !== Number(requestRow.amount) ||
      refund.currency !== String(requestRow.currency).toUpperCase()
    ) {
      const updated = await client.query(
        `UPDATE refund_requests
            SET status = 'RECONCILIATION_REQUIRED',
                provider_refund_id = $2,
                provider_status = $3,
                provider_snapshot = $4,
                failure_code = 'PROVIDER_REFUND_MISMATCH',
                failure_message = 'Provider refund does not match the authoritative refund intent',
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [requestId, refund.id, refund.status, safeProviderSnapshot(refund)]
      );
      await client.query("COMMIT");
      return mapRequest(updated.rows[0]);
    }

    if (refund.status === "processed") {
      await completeFullRefund(client, payment, requestRow, refund);
    } else {
      await client.query(
        `UPDATE refund_requests
            SET status = 'PROVIDER_PENDING',
                provider_refund_id = $2,
                provider_status = $3,
                provider_snapshot = $4,
                failure_code = NULL,
                failure_message = NULL,
                updated_at = now()
          WHERE id = $1`,
        [requestId, refund.id, refund.status, safeProviderSnapshot(refund)]
      );
    }
    await client.query("COMMIT");
    return getRefundRequest(requestId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function initiateFullRefund(
  localPaymentId: string,
  actor: RefundActor,
  gateway: RefundGateway = razorpayRefundGateway
): Promise<{ request: RefundRequest; idempotent: boolean }> {
  const intent = await createOrLoadFullRefundIntent(localPaymentId, actor);
  if (intent.status === "COMPLETED") return { request: intent, idempotent: true };

  const transition = await moveToGatewayRequested(intent.id);
  if (!transition.shouldCallGateway) {
    return { request: transition.request, idempotent: true };
  }

  try {
    const refund = await gateway.createFullRefund({
      paymentId: transition.request.razorpayPaymentId,
      amountPaise: transition.request.amountPaise,
      refundRequestId: transition.request.id,
      idempotencyKey: transition.request.idempotencyKey,
    });
    return {
      request: await persistProviderOutcome(transition.request.id, refund),
      idempotent: false,
    };
  } catch (error: any) {
    const failed = await persistGatewayFailure(transition.request.id, error);
    if (failed.status === "FAILED") {
      throw new PaymentDomainError(
        502,
        "REFUND_GATEWAY_REJECTED",
        "Payment gateway rejected the refund request"
      );
    }
    return { request: failed, idempotent: false };
  }
}

/**
 * Apply a verified provider refund event inside the caller transaction.
 * Phase 1 supports full refunds only. API, webhook and reconciliation all use
 * the same refund_requests row so no race can create a second ledger effect.
 */
export async function finalizeRefund(
  client: PoolClient,
  input: {
    paymentId: string;
    refundId?: string;
    refundAmountPaise: number;
    providerStatus?: string;
  }
): Promise<RefundResult> {
  const payment = await loadPayment(client, { gatewayPaymentId: input.paymentId });
  const amount = authoritativeAmount(payment);
  if (input.refundAmountPaise !== amount) {
    throw new PaymentDomainError(
      409,
      "PARTIAL_REFUND_NOT_SUPPORTED",
      "Phase 1 supports full refunds only"
    );
  }

  let requestResult = await client.query(
    `SELECT * FROM refund_requests WHERE payment_id = $1 FOR UPDATE`,
    [payment.id]
  );
  let requestRow = requestResult.rows?.[0];
  if (!requestRow) {
    requestRow = await insertIntent(client, payment, { role: "SYSTEM" });
  }

  const refund: GatewayRefund = {
    id: String(input.refundId || requestRow.provider_refund_id || "").trim(),
    paymentId: input.paymentId,
    amountPaise: input.refundAmountPaise,
    currency: String(payment.currency || "INR").toUpperCase(),
    status: String(input.providerStatus || "processed").toLowerCase(),
    notes: {},
  };
  if (!refund.id) {
    throw new PaymentDomainError(
      409,
      "REFUND_REFERENCE_REQUIRED",
      "Provider refund reference is required before finalization"
    );
  }

  if (refund.status !== "processed") {
    await client.query(
      `UPDATE refund_requests
          SET status = 'PROVIDER_PENDING',
              provider_refund_id = $2,
              provider_status = $3,
              provider_snapshot = $4,
              updated_at = now()
        WHERE id = $1`,
      [requestRow.id, refund.id, refund.status, safeProviderSnapshot(refund)]
    );
    return {
      subscriptionId: Number(payment.subscription_id),
      userId: Number(payment.user_id),
      artistId: Number(payment.artist_id),
      fullRefund: false,
      paymentAmountPaise: amount,
      refundAmountPaise: amount,
    };
  }

  return completeFullRefund(client, payment, requestRow, refund);
}

export async function getRefundRequest(requestId: string): Promise<RefundRequest> {
  if (!isUuid(requestId)) {
    throw new PaymentDomainError(
      400,
      "INVALID_REFUND_REQUEST_ID",
      "Refund request id is invalid"
    );
  }
  const result = await pool.query(`SELECT * FROM refund_requests WHERE id = $1`, [requestId]);
  if (!result.rows.length) {
    throw new PaymentDomainError(404, "REFUND_REQUEST_NOT_FOUND", "Refund request not found");
  }
  return mapRequest(result.rows[0]);
}

function matchesRequest(request: RefundRequest, refund: GatewayRefund) {
  if (request.providerRefundId && refund.id === request.providerRefundId) return true;
  return (
    String(refund.notes?.refund_request_id || "") === request.id ||
    String(refund.notes?.idempotency_key || "") === request.idempotencyKey
  );
}

export async function reconcileRefundRequest(
  requestId: string,
  gateway: RefundGateway = razorpayRefundGateway
): Promise<RefundRequest> {
  const request = await getRefundRequest(requestId);
  if (request.status === "COMPLETED") return request;

  const refunds = await gateway.listRefunds(request.razorpayPaymentId);
  const matching = refunds.find((refund) => matchesRequest(request, refund));
  if (matching) {
    const reconciled = await persistProviderOutcome(request.id, matching);
    await pool.query(
      `UPDATE refund_requests SET last_reconciled_at = now(), updated_at = now() WHERE id = $1`,
      [request.id]
    );
    return getRefundRequest(reconciled.id);
  }

  const providerPayment = await gateway.fetchPayment(request.razorpayPaymentId);
  let code = "PROVIDER_REFUND_NOT_FOUND";
  let message = "No matching provider refund is visible yet";
  if (providerPayment.amountRefundedPaise > 0 && providerPayment.amountRefundedPaise < request.amountPaise) {
    code = "UNSUPPORTED_PARTIAL_REFUND_DETECTED";
    message = "Provider reports a partial refund, which is outside Phase 1 policy";
  } else if (providerPayment.amountRefundedPaise >= request.amountPaise) {
    code = "PROVIDER_REFUND_REFERENCE_MISSING";
    message = "Provider reports a full refund but its refund reference could not be matched";
  }

  await pool.query(
    `UPDATE refund_requests
        SET status = 'RECONCILIATION_REQUIRED',
            provider_status = $2,
            failure_code = $3,
            failure_message = $4,
            provider_snapshot = $5,
            last_reconciled_at = now(),
            updated_at = now()
      WHERE id = $1 AND status <> 'COMPLETED'`,
    [
      request.id,
      providerPayment.refundStatus,
      code,
      message,
      {
        payment_id: providerPayment.paymentId,
        amount: providerPayment.amountPaise,
        amount_refunded: providerPayment.amountRefundedPaise,
        currency: providerPayment.currency,
        status: providerPayment.status,
        refund_status: providerPayment.refundStatus,
      },
    ]
  );
  return getRefundRequest(request.id);
}

export async function reconcilePendingRefunds(
  gateway: RefundGateway = razorpayRefundGateway,
  limit = 50
) {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const result = await pool.query(
    `SELECT id FROM refund_requests
      WHERE status IN ('GATEWAY_REQUESTED', 'PROVIDER_PENDING', 'RECONCILIATION_REQUIRED')
      ORDER BY updated_at ASC
      LIMIT $1`,
    [boundedLimit]
  );

  const outcomes: Array<{ id: string; status: string; error?: string }> = [];
  for (const row of result.rows) {
    try {
      const reconciled = await reconcileRefundRequest(String(row.id), gateway);
      outcomes.push({ id: reconciled.id, status: reconciled.status });
    } catch (error: any) {
      outcomes.push({
        id: String(row.id),
        status: "RECONCILIATION_ERROR",
        error: String(error?.code || error?.message || "unknown"),
      });
    }
  }
  return outcomes;
}
