# 07 — Payments, Razorpay Webhooks, Refunds & Reconciliation

## Scope

Covers payment-intent/order creation, Razorpay test checkout, exact raw-body signature verification, idempotent webhook processing, payment/subscription transaction integrity, duplicate/out-of-order event handling, manual admin/finance refund, entitlement after refund, ledger consistency, reconciliation tooling and failure recovery.

## Automated gates

```bash
cd backend
npm run test:payment-integrity
npm run test:refund-integrity-contract
npm run test:refund-integrity-db
npm run report:refund-reconciliation
npm run verify
```

Run DB/provider commands only against isolated QA/test infrastructure.

## Payment creation positive cases

| ID | Test | Expected |
|---|---|---|
| PAY-POS-001 | valid paid Artist monthly purchase | backend creates canonical pending payment/order using current server price |
| PAY-POS-002 | valid supported yearly purchase | server uses current yearly price if supported |
| PAY-POS-003 | valid Razorpay test success | local payment becomes successful exactly once; subscription activation follows authoritative event |
| PAY-POS-004 | client callback lost but webhook arrives | backend still reaches correct success/entitlement state |
| PAY-POS-005 | webhook delayed | UI remains pending, later converges to success |
| PAY-POS-006 | gateway payment failure | local state records failure; no protected access |
| PAY-POS-007 | user closes/cancels checkout | no false success/unlock |

## Signature/raw-body security

For the webhook endpoint test:

- valid exact raw body + valid Razorpay signature;
- same body with one byte changed after signing;
- valid JSON reparsed/reserialized with different byte representation;
- missing signature header;
- random signature;
- malformed JSON/raw payload;
- oversized body above configured limit.

Expected: only the exact valid signed raw payload can mutate payment/subscription state. Invalid signature is rejected before business mutation.

## Idempotency and ordering matrix

| ID | Scenario | Expected |
|---|---|---|
| PAY-IDEM-001 | same event delivered twice | second delivery no-op/idempotent success response as designed |
| PAY-IDEM-002 | duplicate success events with different delivery attempts | one financial result, one entitlement result |
| PAY-IDEM-003 | client confirmation and webhook race | one result |
| PAY-IDEM-004 | success then stale failure | authoritative state does not incorrectly regress |
| PAY-IDEM-005 | failure then later valid success where gateway lifecycle permits | deterministic final state consistent with gateway truth |
| PAY-IDEM-006 | unknown order/payment reference | no arbitrary subscription mutation |
| PAY-IDEM-007 | event ID collision/replay | replay protection prevents duplicate mutation |

## Price manipulation matrix

Repeat the attacks from `06-SUBSCRIPTIONS.md` and additionally compare:

- amount/currency stored in local payment row;
- gateway order amount;
- current server pricing configuration;
- eventual invoice/transaction amount;
- artist gross revenue ledger source.

Any mismatch that grants access or corrupts revenue is P0.

## Transactional failure injection

Simulate or force controlled failures at these points:

1. after provider order creation but before local pending transaction commits;
2. local payment update succeeds but subscription activation fails;
3. subscription activation succeeds but payment ledger fails;
4. audit insertion fails during sensitive payment mutation where included transactionally;
5. DB unavailable after valid webhook signature verification;
6. process restarts mid-webhook;
7. webhook retry after prior partial/rolled-back attempt.

Expected: transaction rolls back or state is explicitly reconcilable; never acknowledge a provider event as fully processed if local authoritative mutation did not complete according to the current design.

## Refund authorization

- Admin initiates valid refund.
- Finance initiates allowed refund.
- Moderator attempts refund → 403.
- Artist attempts refund → 403.
- Fan attempts refund admin API → 403.
- direct IDOR: privileged user supplies another unrelated payment/subscription combination → server validates relationships.

Destructive financial UI must require clear confirmation and reason where current UX contract requires it.

## Refund state cases

- full valid refund;
- duplicate refund request;
- refund while already processing;
- refund on failed/pending payment;
- refund unknown payment;
- gateway rejects refund;
- gateway timeout/ambiguous result;
- local DB failure after gateway accepted refund;
- duplicate/refund webhook event;
- refund completion after user/session state changed.

For each verify:

1. provider/gateway state;
2. local payment/refund state;
3. transaction/invoice presentation;
4. subscription entitlement effect according to current policy;
5. `/stream/access` result;
6. artist/admin gross revenue summary;
7. audit trail;
8. reconciliation report.

## Reconciliation

Run:

```bash
npm run report:refund-reconciliation
```

and any approved payment reconciliation utility available in the tested revision.

Seed controlled discrepancies in QA where possible:

- gateway success/local pending;
- gateway refunded/local success;
- duplicate local payment reference attempt;
- missing subscription link;
- stale pending transaction.

Expected: report identifies discrepancies without silently mutating unless the command explicitly supports controlled repair. Repair actions must be idempotent and audited where applicable.

## Database integrity

Attempt:

- duplicate gateway payment/reference IDs;
- duplicate webhook event IDs;
- invalid payment/subscription FK references;
- invalid state values;
- concurrent successful webhooks for one purchase.

Constraints/transactions must prevent duplicate or contradictory financial truth.

## Logging/PII/secrets

Verify payment logging never contains:

- Razorpay key secret;
- webhook secret;
- full Authorization tokens;
- card/payment instrument sensitive fields not required for support;
- raw signed media tokens;
- unnecessary full webhook payload if it contains sensitive data.

Correlation ID + provider reference should be sufficient to trace a test without secrets.

## Mobile payment UX

- user starts checkout then app backgrounds;
- app killed after payment but before callback;
- callback reports success while webhook not yet received;
- slow webhook > normal UX wait period;
- failed payment and retry;
- duplicate tap on pay button;
- network loss immediately after gateway completion.

Expected: app shows `Confirming/Pending`, not false success; status can be recovered after restart; retry cannot double-activate.

## Exit criteria

Only verified gateway truth can create paid entitlement; duplicate/raced/out-of-order events are safe; refund permissions and state are correct; ambiguous failures are detectable by reconciliation; financial records, subscription access, invoice history, analytics summary and audit trail agree.
