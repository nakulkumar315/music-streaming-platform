import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const backendRoot = path.resolve(__dirname, "../..");
const srcRoot = path.join(backendRoot, "src");

function source(relativePath: string) {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

function backendFile(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function main() {
  const migration = backendFile("db/migrations/20260913_0006_refund_intent_integrity.sql");
  const refundService = source("modules/payment/payment.refund.service.ts");
  const refundGateway = source("modules/payment/payment.refund.gateway.ts");
  const refundController = source("controllers/admin/adminRefundController.ts");
  const refundQuery = source("modules/payment/payment.refund.query.ts");
  const refundRoutes = source("routes/admin/refunds.ts");
  const adminIndex = source("routes/admin/index.ts");
  const cancellation = source("modules/subscription/subscription.cancellation.service.ts");
  const subscriptionController = source("controllers/admin/adminSubscriptionController.ts");
  const paymentController = source("controllers/paymentController.ts");
  const entitlement = source("shared/security/artist-entitlement.service.ts");
  const schemaReadiness = source("common/db/schema-readiness.ts");

  assert.equal(migration.includes("CREATE TABLE refund_requests"), true);
  assert.equal(migration.includes("UNIQUE (payment_id)"), true, "One Phase-1 full refund must map to one payment intent");
  assert.equal(migration.includes("RECONCILIATION_REQUIRED"), true);
  assert.equal(migration.includes("provider_refund_id"), true);

  assert.equal(schemaReadiness.includes('LATEST_SCHEMA_VERSION = "20260913_0006_refund_intent_integrity"'), true, "Service startup must require the refund schema");
  assert.equal(schemaReadiness.includes("refund_requests"), true, "Refund ledger columns must be checked at startup");

  assert.equal(refundService.includes("full-refund:${String(payment.id)}"), true, "Refund identity must be server-derived");
  assert.equal(refundService.includes("PARTIAL_REFUND_NOT_SUPPORTED"), true, "Partial refund is outside approved Phase-1 scope");
  assert.equal(refundService.includes("GATEWAY_REQUESTED"), true, "Remote call must have a durable pre-call state");
  assert.equal(refundService.includes("RECONCILIATION_REQUIRED"), true, "Ambiguous outcomes must remain repairable");
  assert.equal(refundService.includes("LOCAL_REFUND_FINALIZATION_FAILED"), true, "Provider success plus local failure must reconcile rather than retry");
  assert.equal(refundService.includes("PROVIDER_REFUND_FAILED"), true, "Asynchronous provider failure must be terminal and explicit");
  assert.equal(refundService.includes('refund.status === "failed"'), true, "Provider failed state must not remain pending");
  assert.equal(refundService.includes("Canonical financial lock order is payment/subscription -> refund request"), true, "Webhook/API refund paths must use one lock order");
  assert.equal(refundService.includes("UPDATE payments SET status = 'REFUNDED'"), true);
  assert.equal(refundService.includes("SET status = 'CANCELLED'"), true, "Confirmed full refund must revoke subscription entitlement");
  assert.equal(refundService.includes("refund_amount = $2"), true, "Refund must preserve captured amount and write refund amount separately");
  assert.equal(refundService.includes("REFUND_SUCCESS"), true, "Financial completion needs durable audit evidence");

  assert.equal(refundGateway.includes("refund_request_id"), true, "Provider notes must carry the durable request identifier");
  assert.equal(refundGateway.includes("fetchMultipleRefund"), true, "Reconciliation must query provider refunds rather than blindly retry");
  assert.equal(refundGateway.includes("amount_refunded"), true, "Reconciliation must compare provider payment refund totals");

  assert.equal(refundController.includes("REFUND_AMOUNT_NOT_ACCEPTED"), true, "Client/admin must not submit arbitrary refund amount");
  assert.equal(refundRoutes.includes('router.get("/payments", listRefundablePayments)'), true, "FINANCE needs payment/refund review visibility");
  assert.equal(refundRoutes.includes('router.post("/payments/:paymentId"'), true);
  assert.equal(refundRoutes.includes('requireRoles("ADMIN")'), true, "Operational reconciliation remains ADMIN-only");
  assert.equal(adminIndex.includes('requireRoles("ADMIN", "FINANCE")'), true, "FINANCE must have refund access without broader admin permissions");
  assert.equal(refundQuery.includes("LEFT JOIN refund_requests"), true, "Payment review must include durable refund state");
  assert.equal(refundQuery.includes("refund_amount"), true, "Payment review must preserve original payment and separate refund amount");

  assert.equal(cancellation.includes("financial_refund: false"), true, "Cancellation must remain financially distinct from refund");
  assert.equal(cancellation.includes("status = 'CANCELLED'"), true);
  assert.equal(cancellation.includes("payments"), false, "Cancellation service must not mutate payment/refund ledger");
  assert.equal(cancellation.includes("razorpay"), false, "Canonical Phase-1 cancellation must not invent a recurring gateway subscription");
  assert.equal(subscriptionController.includes("SUBSCRIPTION_STATUS_MANAGED_BY_STATE_MACHINE"), true, "Manual status patch must not bypass financial state machines");
  assert.equal(subscriptionController.includes("razorpayClient"), false, "Legacy best-effort gateway cancellation must be removed");
  assert.equal(subscriptionController.includes("grace_ends_at"), false, "Greenfield support controller must not reference a non-canonical subscription column");

  assert.equal(paymentController.includes('case "refund.processed"'), true, "Verified refund webhook remains authoritative final signal");
  assert.equal(paymentController.includes("finalizeRefund(client"), true, "Webhook must converge on canonical refund service");
  assert.equal(entitlement.includes("s.status = 'ACTIVE'"), true, "Refund/cancellation status transition must revoke Phase-02 entitlement");
  assert.equal(entitlement.includes("s.next_billing_date > now()"), true, "Entitlement remains time-bound as well as state-bound");

  console.log("Phase 01A refund/cancellation contract checks passed.");
}

main();
