# 09 — Analytics & Reporting

## Scope

Covers trusted play/view event ingestion, heartbeat/session validation, deduplication, subscriber counts, artist gross earnings, admin analytics, failure isolation, concurrency abuse and ownership.

## Core rules

- Analytics must never grant entitlement.
- Analytics failure must never block authorized playback or payment.
- Trusted playback/session evidence, not arbitrary client claims, controls play/view metrics.
- Gross earnings come from authoritative captured financial records, not play counts.
- Artist analytics is ownership-scoped.

## Automated gates

```bash
cd backend
npm run test:phase08-operational
npm run verify
```

## Positive cases

| ID | Test | Expected |
|---|---|---|
| ANA-POS-001 | authorized playback starts | trusted session/event recorded according to qualifying rules |
| ANA-POS-002 | qualifying audio play | play count increments once at defined threshold/event |
| ANA-POS-003 | qualifying video view | view count increments according to trusted rule |
| ANA-POS-004 | completed playback | completion/listening-time fields bounded correctly |
| ANA-POS-005 | Artist A opens own analytics | only Artist A metrics shown |
| ANA-POS-006 | Admin opens platform analytics | aggregate values reconcile to underlying data |
| ANA-POS-007 | subscriber count | matches authoritative active subscription definition |
| ANA-POS-008 | gross earnings | matches captured/payment ledger definition; refunded amounts treated according to current reporting rule |

## Abuse/negative matrix

- heartbeat every second;
- duplicate heartbeat payload;
- duplicate event ID;
- forged playback session;
- playback session belonging to another Fan;
- content ID not belonging to playback session;
- artist ID altered in event;
- huge position jump;
- negative position/duration;
- completion before plausible playback time;
- repeated qualifying-play event for same session;
- concurrent duplicate events;
- event after session ended/revoked;
- event after content takedown;
- unauthenticated analytics request;
- Artist A queries Artist B private analytics.

Expected: events are rejected/bounded/deduplicated as appropriate; no metric inflation via obvious client forging; no cross-user/artist data leak.

## Failure isolation

Force analytics write/query failure while:

1. authorized audio is playing;
2. authorized video is playing;
3. payment is being confirmed;
4. admin content action is executing.

Expected: analytics failure is observable but does not block playback/payment/governance unless the endpoint being used is specifically an analytics/report endpoint.

## Listening-time correctness

Test:

- short playback below qualifying threshold;
- playback exactly at threshold;
- pause periods;
- seek forward/back;
- app background;
- disconnected network and later heartbeat;
- heartbeat outside server-bounded elapsed time;
- two devices playing same content;
- session restart.

Server-bounded time must prevent a client from claiming hours of listening within seconds.

## Subscriber count

Create controlled subscription states:

- ACTIVE;
- PENDING;
- EXPIRED;
- FAILED payment;
- REFUNDED/revoked;
- CANCELLED if supported.

Verify count uses the approved active-entitlement definition, not all historical rows.

## Gross revenue

Seed/capture known QA payments and refunds. Verify artist/admin gross revenue against authoritative payment ledger/database query. Attempt forged analytics events and confirm revenue never changes because of them.

## Concurrency/job safety

Where background aggregation jobs exist:

- run same worker/job from two replicas concurrently;
- simulate restart after claim but before finish;
- rerun same job window;
- insert events during aggregation.

Expected: row/job claiming and idempotency prevent duplicate aggregation or corrupted totals.

## UI/report checks

Artist dashboard:

- subscriber count;
- per-content plays/views where in scope;
- gross earnings;
- empty state for no data;
- no subscriber PII exposure.

Admin dashboard:

- platform totals;
- per-artist summaries;
- date/filter behavior where implemented;
- loading/error state;
- values consistent after refresh.

## Data privacy/logging

Inspect analytics rows/logs for unnecessary PII. Events should use only the identifiers needed for measurement. Signed URLs, tokens, passwords and payment secrets must never appear in raw analytics payloads/logs.

## Exit criteria

Analytics is trusted, bounded, deduplicated and ownership-scoped; failure remains non-blocking to core business paths; subscriber/revenue figures reconcile to authoritative subscription/payment data; and abuse cannot materially inflate or leak metrics.
