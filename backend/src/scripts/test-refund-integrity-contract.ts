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
  const prisma = backendFile("prisma/schema.prisma");
  const refundService = source("modules/payment/payment.refund.service.ts");
  const refundGateway = source("modules/payment/payment.refund.gateway.ts");
  const refundWebhook = source("modules/payment/payment.refund.webhook.ts");
  const refundReconciliation = source("modules/payment/payment.refund.reconciliation.ts");
  const refundController = source("controllers/admin/adminRefundController.ts");
  const refundQuery = source("modules/payment/payment.refund.query.ts");
  const refundRoutes = source("routes/admin/refunds.ts");
  const adminIndex = source("routes/admin/index.ts");
  const cancellation = source("modules/subscription/subscription.cancellation.service.ts");
  const subscriptionController = source("controllers/admin/adminSubscriptionController.ts");
  const paymentController = source("controllers/paymentController.ts");
  const entitlement = source("shared/security/artist-entitlement.service.ts");
  const schemaReadiness = source("common/db/schema-readiness.ts");
  const reconciliationScript = source("scripts/reconcile-refunds.ts");

  assert.equal(migration.includes("CREATE TABLE refund_requests"), true);
  assert.equal(migration.includes("UNIQUE (payment_id)"), true, "One Phase-1 full refund must map to one payment intent");
  assert.equal(migration.includes("fk_refund_requests_payment"), true);
  assert.equal(migration.includes("fk_refund_requests_subscription"), true);
  assert.equal(migration.includes("fk_refund_requests_user"), true);
  assert.equal(migration.includes("fk_refund_requests_requested_by"), true);
  assert.equal(migration.includes("refund_requests_requested_by_role_valid"), true);
  assert.equal(migration.includes("RECONCILIATION_REQUIRED"), true);
  assert.equal(migration.includes("provider_refund_id"), true);

  assert.equal(prisma.includes("model refund_requests"), true, "Prisma contract must include the canonical refund ledger");
  assert.equal(prisma.includes("provider_refund_id"), true);
  assert.equal(prisma.includes("idempotency_key"), true);

  const latestVersionMatch = schemaReadiness.match(/LATEST_SCHEMA_VERSION = "([^"]+)"/);
  assert.ok(
    latestVersionMatch && latestVersionMatch[1] >= "20260913_0006_refund_intent_integrity",
    "Service startup must require at least the refund schema"
  );
  assert.equal(schemaReadiness.includes("refund_requests"), true, "Refund ledger columns must be checked at startup");
  assert.equal(schemaReadiness.includes("fk_refund_requests_payment"), true, "Refund relational constraints must be checked at startup");

  assert.equal(refundService.includes("full-refund:${String(payment.id)}"), true, "Refund identity must be server-derived");
  assert.equal(refundService.includes("PARTIAL_REFUND_NOT_SUPPORTED"), true, "Direct canonical finalization remains full-refund-only");
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

  assert.equal(refundWebhook.includes("UNSUPPORTED_PARTIAL_REFUND_DETECTED"), true, "Out-of-scope provider partial refunds must be quarantined, not normalized");
  assert.equal(refundWebhook.includes("RECONCILIATION_REQUIRED"), true, "Provider partial refund anomaly must remain operationally visible");
  assert.equal(refundWebhook.includes("entitlement_changed: false"), true, "Unsupported provider partial refund must not silently revoke entitlement");
  assert.equal(refundWebhook.includes("completed_ledger_preserved"), true, "Later provider anomaly must not rewrite completed financial history");
  assert.equal(refundWebhook.includes("return finalizeRefund(client"), true, "Valid full provider refund events must converge on canonical finalizer");

  assert.equal(refundReconciliation.includes("r.id IS NULL"), true, "Reconciliation must detect provider refunds with no local intent");
  assert.equal(refundReconciliation.includes("CORRECTED_FULL_REFUND"), true, "Missed full-refund webhook must be repairable");
  assert.equal(refundReconciliation.includes("PARTIAL_REFUND_DETECTED"), true, "Out-of-scope provider partial refund must be surfaced as an anomaly");
  assert.equal(refundReconciliation.includes("finalizeRefund(client"), true, "Drift repair must converge on the canonical refund finalizer");
  assert.equal(reconciliationScript.includes("reconcileProviderRefundDrift"), true, "Operational reconciliation must scan provider-only drift as well as local pending requests");

  assert.equal(refundController.includes("REFUND_AMOUNT_NOT_ACCEPTED"), true, "Client/admin must not submit arbitrary refund amount");
  assert.equal(refundRoutes.includes('router.get("/payments", listRefundablePayments)'), true, "FINANCE needs payment/refund review visibility");
  assert.equal(refundRoutes.includes('router.post("/payments/:paymentId"'), true);
  assert.equal(refundRoutes.includes('requireRoles("ADMIN")'), true, "Operational reconciliation remains ADMIN-only");
  assert.equal(adminIndex.includes('requireRoles("ADMIN", "FINANCE")'), true, "FINANCE must have refund access without broader admin permissions");
  assert.equal(refundQuery.includes("LEFT JOIN refund_requests"), true, "Payment review must include durable refund state");
  assert.equal(refundQuery.includes("refund_amount"), true, "Payment review must preserve original payment and separate refund amount");
  assert.equal(refundQuery.includes("fan.email"), false, "FINANCE refund review must not expose unnecessary fan PII");

  assert.equal(cancellation.includes("financial_refund: false"), true, "Cancellation must remain financially distinct from refund");
  assert.equal(cancellation.includes("status = 'CANCELLED'"), true);
  assert.equal(cancellation.includes("payments"), false, "Cancellation service must not mutate payment/refund ledger");
  assert.equal(cancellation.includes("razorpay"), false, "Canonical Phase-1 cancellation must not invent a recurring gateway subscription");
  assert.equal(subscriptionController.includes("SUBSCRIPTION_STATUS_MANAGED_BY_STATE_MACHINE"), true, "Manual status patch must not bypass financial state machines");
  assert.equal(subscriptionController.includes("razorpayClient"), false, "Legacy best-effort gateway cancellation must be removed");
  assert.equal(subscriptionController.includes("grace_ends_at"), false, "Greenfield support controller must not reference a non-canonical subscription column");

  assert.equal(paymentController.includes('case "refund.created"'), true, "Provider pending refund webhook must be tracked");
  assert.equal(paymentController.includes('case "refund.processed"'), true, "Verified refund processed webhook remains authoritative final signal");
  assert.equal(paymentController.includes('case "refund.failed"'), true, "Provider failed refund webhook must be tracked");
  assert.equal(paymentController.includes("processVerifiedRefundEvent(client"), true, "Refund webhooks must pass through the anomaly-aware canonical refund boundary");
  assert.equal(
    entitlement.includes('status === "ACTIVE"'),
    true,
    "Refund/cancellation status transition must revoke Phase-02 entitlement"
  );
  assert.equal(
    entitlement.includes("expiryMs > Date.now()"),
    true,
    "Entitlement remains time-bound as well as state-bound"
  );

  console.log("Phase 01A refund/cancellation contract checks passed.");
}

main();
