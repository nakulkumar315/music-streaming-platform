# 06 — Subscription Lifecycle & Entitlement

## Scope

Covers artist-wise subscription purchase intent, pending/active/expired/cancelled states where supported, immediate unlock only after authoritative payment confirmation, expiry relock, server-side price authority, subscription ownership, UI reconciliation, and entitlement interaction with playback.

## Core rules

- Payment/webhook truth activates paid entitlement.
- Client success/callback alone never activates access.
- Subscription state is authoritative for protected-content eligibility.
- Fixed-term subscription history must not be rewritten casually during account/privacy operations.
- Expiry/refund/account/content state must be reflected by stream authorization, not merely by UI badges.

## Automated gates

```bash
cd backend
npm run test:payment-integrity
npm run test:refund-integrity-contract
npm run test:playback-session-lease-contract
npm run verify
```

## Positive cases

| ID | Test | Expected |
|---|---|---|
| SUB-POS-001 | Free Fan views protected content | locked + subscription CTA |
| SUB-POS-002 | Fan starts valid artist subscription | pending subscription/payment intent using server price |
| SUB-POS-003 | valid gateway success webhook | exactly one ACTIVE entitlement created/transitioned |
| SUB-POS-004 | app polls/reconciles after webhook | Pending → Active; content unlocks only now |
| SUB-POS-005 | active fan requests protected playback | allowed |
| SUB-POS-006 | subscription reaches expiry | access relocks based on authoritative time/state |
| SUB-POS-007 | active subscription visible in Library/detail | correct artist, dates/status and amount context |
| SUB-POS-008 | duplicate status refresh | read-only/idempotent |

## Price-authority attacks

Attempt purchase requests with:

- `amount=0` for a paid plan;
- `amount=1`;
- extremely high amount;
- negative amount;
- decimal/precision manipulation;
- stale price cached before admin/artist price change;
- Artist A displayed price but Artist B ID;
- monthly displayed price but yearly billing-cycle parameter;
- unsupported/free plan flags invented by client.

Expected: server recomputes/uses authoritative configured plan and rejects inconsistent unsupported requests. No client amount controls entitlement value.

## State-transition cases

Verify allowed/illegal transitions with direct API/provider events:

- PENDING → ACTIVE only from verified payment success;
- PENDING remains non-entitled on failure/cancel/timeout;
- ACTIVE → EXPIRED at expiry;
- ACTIVE → cancellation only if current approved behavior supports it;
- refund/revocation follows current payment policy and does not leave access active incorrectly;
- duplicate success cannot create duplicate active entitlements;
- stale failure after success cannot incorrectly downgrade a later authoritative state;
- out-of-order provider events converge deterministically.

## Ownership/IDOR

Fan A attempts to:

- read Fan B subscription ID;
- poll Fan B pending subscription;
- cancel/change Fan B subscription if such endpoint exists;
- use Fan B subscription ID in stream request;
- alter `fanId` in purchase payload.

Expected: denied; acting Fan identity comes from authentication.

## Concurrency/idempotency

- double-tap Subscribe;
- two simultaneous create-subscription requests for same Fan/Artist;
- webhook and client confirmation race;
- duplicate webhook delivery;
- two gateway success events for same order/payment;
- expiry job while a status read/playback request occurs;
- refund while access refresh is in flight.

Expected: one coherent financial/subscription result, no duplicate active row, no double charge intent from accidental UI duplicate where backend idempotency applies.

## Failure injection

- payment/order record created but subscription insert fails;
- subscription pending record created but provider order creation fails;
- DB connection drops during activation transaction;
- audit write fails if audit is transactionally required by current flow;
- webhook arrives while DB unavailable;
- Redis unavailable;
- reconciliation job runs concurrently twice.

Expected: no paid entitlement is fabricated; ambiguous state is reconcilable; retries do not double activate.

## Expiry boundary tests

Use controlled expiry near current time:

- 1 second before expiry → access according to exact comparison rule;
- at expiry → denied when state/time says expired;
- 1 second after expiry → denied;
- device clock deliberately wrong → server time remains authoritative;
- app offline across expiry then reconnects → stale UI may display briefly but protected access is denied until refreshed.

## UI truthfulness

Mobile subscription/payment screens must show:

- clear price/artist before gateway;
- Processing/Pending after gateway returns until backend confirms;
- Active only after backend truth;
- Failed/cancelled payment without unlock;
- Expired state with renew CTA where supported;
- no false "success" from Razorpay client callback alone.

## Cross-module tests

After each state transition verify:

1. subscription API;
2. payment ledger;
3. Fan library;
4. content lock indicator;
5. `/stream/access` outcome;
6. audit entry for sensitive transition where required;
7. artist subscriber count eventually updates from authoritative subscription data.

## Exit criteria

No client-controlled field can create entitlement, webhook/payment authority is respected, state transitions are idempotent and transactionally safe, expiry/refund immediately governs playback eligibility, and all cross-module views converge to the same subscription truth.
