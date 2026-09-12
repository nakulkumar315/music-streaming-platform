import "dotenv/config";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import type {
  GatewayRefund,
  RefundGateway,
} from "../modules/payment/payment.refund.gateway";

class MockRefundGateway implements RefundGateway {
  createCalls = 0;
  mode: "processed" | "ambiguous" = "processed";
  lastInput:
    | {
        paymentId: string;
        amountPaise: number;
        refundRequestId: string;
        idempotencyKey: string;
      }
    | null = null;

  async createFullRefund(input: {
    paymentId: string;
    amountPaise: number;
    refundRequestId: string;
    idempotencyKey: string;
  }): Promise<GatewayRefund> {
    this.createCalls += 1;
    this.lastInput = input;
    if (this.mode === "ambiguous") {
      throw new Error("simulated network timeout after gateway acceptance");
    }
    return this.refund("processed");
  }

  async listRefunds(): Promise<GatewayRefund[]> {
    return this.lastInput ? [this.refund("processed")] : [];
  }

  async fetchPayment(paymentId: string) {
    const amount = this.lastInput?.amountPaise ?? 0;
    return {
      paymentId,
      amountPaise: amount,
      amountRefundedPaise: amount,
      currency: "INR",
      status: "captured",
      refundStatus: "full",
    };
  }

  private refund(status: string): GatewayRefund {
    if (!this.lastInput) throw new Error("No refund input recorded");
    return {
      id: `rfnd_test_${this.lastInput.refundRequestId.replace(/-/g, "").slice(0, 12)}`,
      paymentId: this.lastInput.paymentId,
      amountPaise: this.lastInput.amountPaise,
      currency: "INR",
      status,
      notes: {
        refund_request_id: this.lastInput.refundRequestId,
        idempotency_key: this.lastInput.idempotencyKey,
      },
    };
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run refund DB tests with NODE_ENV=production");
  }
  const testDatabaseUrl = String(process.env.AUTH_TEST_DATABASE_URL || "").trim();
  if (!testDatabaseUrl) {
    throw new Error(
      "AUTH_TEST_DATABASE_URL is required. Use a disposable database with all canonical migrations applied."
    );
  }
  process.env.DATABASE_URL = testDatabaseUrl;

  const [{ pool }, refundModule, cancellationModule] = await Promise.all([
    import("../common/db"),
    import("../modules/payment/payment.refund.service"),
    import("../modules/subscription/subscription.cancellation.service"),
  ]);
  const {
    initiateFullRefund,
    finalizeRefund,
    getRefundRequest,
    reconcileRefundRequest,
  } = refundModule;
  const { cancelSubscription } = cancellationModule;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userIds: number[] = [];
  const subscriptionIds: number[] = [];
  const paymentIds: string[] = [];

  async function createUser(role: "FAN" | "ARTIST") {
    const result = await pool.query(
      `INSERT INTO users (email, password, role, status, is_deleted, artist_status, is_verified, name)
       VALUES ($1, 'test-hash', $2, 'ACTIVE', false, $3, $4, 'Refund Test')
       RETURNING id`,
      [
        `refund-${role.toLowerCase()}-${suffix}-${userIds.length}@example.invalid`,
        role,
        role === "ARTIST" ? "APPROVED" : "PENDING",
        role === "ARTIST",
      ]
    );
    const id = Number(result.rows[0].id);
    userIds.push(id);
    return id;
  }

  const fanId = await createUser("FAN");
  const artistId = await createUser("ARTIST");

  async function createCapturedPurchase(index: number, paymentStatus = "SUCCESS") {
    const subscription = await pool.query(
      `INSERT INTO subscriptions
         (user_id, artist_id, status, plan_type, start_date, next_billing_date, auto_renew, type, created_at, updated_at)
       VALUES ($1, $2, 'ACTIVE', 'MONTHLY', now(), now() + interval '30 days', false, 'ARTIST', now(), now())
       ON CONFLICT (user_id, artist_id)
       DO UPDATE SET status = 'ACTIVE', canceled_at = NULL, next_billing_date = now() + interval '30 days', updated_at = now()
       RETURNING id`,
      [fanId, artistId]
    );
    const subscriptionId = Number(subscription.rows[0].id);
    if (!subscriptionIds.includes(subscriptionId)) subscriptionIds.push(subscriptionId);

    const gatewayPaymentId = `pay_phase01a_${suffix}_${index}`;
    const gatewayOrderId = `order_phase01a_${suffix}_${index}`;
    const amount = 12345 + index;
    await pool.query(
      `INSERT INTO transactions
         (user_id, artist_id, amount, currency, status, razorpay_order_id,
          razorpay_payment_id, artist_name, billing_cycle, payment_confirmed_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'INR', $4, $5, $6, 'Refund Artist', 'monthly', now(), now(), now())`,
      [fanId, artistId, amount, paymentStatus, gatewayOrderId, gatewayPaymentId]
    );

    const paymentId = uuidv4();
    paymentIds.push(paymentId);
    await pool.query(
      `INSERT INTO payments
         (id, user_id, subscription_id, amount, status, razorpay_payment_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [paymentId, fanId, subscriptionId, amount, paymentStatus, gatewayPaymentId]
    );

    return { subscriptionId, paymentId, gatewayPaymentId, amount };
  }

  try {
    // Full refund derives its amount from the captured payment and revokes access.
    const first = await createCapturedPurchase(1);
    const gateway = new MockRefundGateway();
    const firstRefund = await initiateFullRefund(
      first.paymentId,
      { userId: 900001, role: "FINANCE" },
      gateway
    );
    assert.equal(firstRefund.request.status, "COMPLETED");
    assert.equal(firstRefund.request.amountPaise, first.amount);
    assert.equal(gateway.createCalls, 1);

    const firstPayment = await pool.query(`SELECT status, amount FROM payments WHERE id = $1`, [first.paymentId]);
    assert.equal(firstPayment.rows[0].status, "REFUNDED");
    assert.equal(Number(firstPayment.rows[0].amount), first.amount, "Captured amount must be preserved");

    const firstSub = await pool.query(`SELECT status FROM subscriptions WHERE id = $1`, [first.subscriptionId]);
    assert.equal(firstSub.rows[0].status, "CANCELLED", "Full refund must immediately revoke entitlement");

    const firstTx = await pool.query(
      `SELECT status, refund_amount, refund_status FROM transactions WHERE razorpay_payment_id = $1`,
      [first.gatewayPaymentId]
    );
    assert.equal(firstTx.rows[0].status, "REFUNDED");
    assert.equal(Number(firstTx.rows[0].refund_amount), first.amount);
    assert.equal(firstTx.rows[0].refund_status, "REFUNDED");

    // Repeat request is idempotent and never calls the provider again.
    const duplicate = await initiateFullRefund(
      first.paymentId,
      { userId: 900001, role: "FINANCE" },
      gateway
    );
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.request.status, "COMPLETED");
    assert.equal(gateway.createCalls, 1, "Duplicate refund must not create another gateway refund");

    // Failed/uncaptured local payment is not refundable.
    const failed = await createCapturedPurchase(2, "FAILED");
    await assert.rejects(
      () =>
        initiateFullRefund(
          failed.paymentId,
          { userId: 900001, role: "FINANCE" },
          new MockRefundGateway()
        ),
      (error: any) => error?.code === "PAYMENT_NOT_REFUNDABLE"
    );

    // Concurrent double-clicks converge on one durable intent and one provider call.
    const concurrent = await createCapturedPurchase(3);
    const concurrentGateway = new MockRefundGateway();
    const concurrentResults = await Promise.all([
      initiateFullRefund(concurrent.paymentId, { userId: 900001, role: "ADMIN" }, concurrentGateway),
      initiateFullRefund(concurrent.paymentId, { userId: 900001, role: "ADMIN" }, concurrentGateway),
    ]);
    assert.equal(concurrentGateway.createCalls, 1, "Concurrent refund race must call gateway once");
    assert.ok(concurrentResults.every((result) => result.request.paymentId === concurrent.paymentId));
    const refundRows = await pool.query(`SELECT COUNT(*)::int AS count FROM refund_requests WHERE payment_id = $1`, [concurrent.paymentId]);
    assert.equal(refundRows.rows[0].count, 1, "One payment must have one logical refund request");

    // Ambiguous gateway timeout remains reconcilable and must not be retried blindly.
    const ambiguous = await createCapturedPurchase(4);
    const ambiguousGateway = new MockRefundGateway();
    ambiguousGateway.mode = "ambiguous";
    const ambiguousResult = await initiateFullRefund(
      ambiguous.paymentId,
      { userId: 900001, role: "ADMIN" },
      ambiguousGateway
    );
    assert.equal(ambiguousResult.request.status, "RECONCILIATION_REQUIRED");
    assert.equal(ambiguousGateway.createCalls, 1);

    const retry = await initiateFullRefund(
      ambiguous.paymentId,
      { userId: 900001, role: "ADMIN" },
      ambiguousGateway
    );
    assert.equal(retry.idempotent, true);
    assert.equal(ambiguousGateway.createCalls, 1, "Ambiguous outcome must never trigger a blind second refund");

    const reconciled = await reconcileRefundRequest(ambiguousResult.request.id, ambiguousGateway);
    assert.equal(reconciled.status, "COMPLETED");
    assert.equal(ambiguousGateway.createCalls, 1);

    // Provider/webhook partial refund is explicitly rejected in Phase 1.
    const partial = await createCapturedPurchase(5);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assert.rejects(
        () =>
          finalizeRefund(client, {
            paymentId: partial.gatewayPaymentId,
            refundId: "rfnd_partial_test",
            refundAmountPaise: partial.amount - 1,
            providerStatus: "processed",
          }),
        (error: any) => error?.code === "PARTIAL_REFUND_NOT_SUPPORTED"
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    // Cancellation is a separate entitlement transition and leaves money untouched.
    const cancelOnly = await createCapturedPurchase(6);
    const cancelled = await cancelSubscription(
      cancelOnly.subscriptionId,
      { userId: 900001, role: "ADMIN" },
      "Support cancellation test"
    );
    assert.equal(cancelled.status, "CANCELLED");
    const cancelPayment = await pool.query(`SELECT status FROM payments WHERE id = $1`, [cancelOnly.paymentId]);
    assert.equal(cancelPayment.rows[0].status, "SUCCESS", "Cancellation must not fabricate a refund");
    const cancelRefund = await pool.query(`SELECT COUNT(*)::int AS count FROM refund_requests WHERE payment_id = $1`, [cancelOnly.paymentId]);
    assert.equal(cancelRefund.rows[0].count, 0, "Cancellation must not create refund intent");

    // Refund status remains queryable without altering it.
    const queried = await getRefundRequest(firstRefund.request.id);
    assert.equal(queried.status, "COMPLETED");

    console.log("Phase 01A refund/cancellation DB integration checks passed.");
  } finally {
    if (paymentIds.length) {
      await pool.query(`DELETE FROM refund_requests WHERE payment_id = ANY($1::uuid[])`, [paymentIds]).catch(() => undefined);
      await pool.query(`DELETE FROM payments WHERE id = ANY($1::uuid[])`, [paymentIds]).catch(() => undefined);
    }
    await pool.query(`DELETE FROM transactions WHERE razorpay_payment_id LIKE $1`, [`pay_phase01a_${suffix}_%`]).catch(() => undefined);
    if (subscriptionIds.length) {
      await pool.query(`DELETE FROM subscription_audit_logs WHERE subscription_id = ANY($1::int[])`, [subscriptionIds]).catch(() => undefined);
      await pool.query(`DELETE FROM subscriptions WHERE id = ANY($1::int[])`, [subscriptionIds]).catch(() => undefined);
    }
    if (userIds.length) {
      await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]).catch(() => undefined);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
