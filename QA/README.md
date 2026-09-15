# Music Streaming Platform — Production Readiness QA

## Purpose

This folder is the executable QA specification for Phase 1 of `jasiqlabs/music-streaming-platform`.

It is not a smoke-test checklist. It defines how QA must build, run, validate, break, recover, and finally accept the complete system across backend, database, Admin Web, Artist Web, Fan Mobile Android/iOS, payment gateway, media provider, analytics, audit, privacy/recovery, and Phase-2 distribution-readiness boundaries.

A feature is not considered production-ready because the happy path works. Production readiness requires positive, negative, edge, authorization, concurrency, retry/idempotency, failure-recovery, security, data-integrity, UX-state, observability, and migration evidence.

## Authoritative source hierarchy

QA must interpret requirements in this order:

1. DEAL AGREEMENT — contractual Phase-1 boundary.
2. Product Requirements Document (PRD) — approved behavior and NFRs.
3. Music Distribution to Other Platforms — Phase-2 boundary/readiness intent.
4. HLD v1.3 LOCKED — architecture/module boundaries.
5. DLD v1.3 Parts 0–9 — detailed contracts.
6. Production-Safe UI/UX Architecture — client behavior and UX state rules.
7. FINAL Phase-Wise Feature Delivery & Deployment Plan — vertical-slice acceptance.
8. Current hardening/remediation strategy and phase pages.
9. Current code on the tested revision.

Primary Confluence pages:

- Deal Agreement: page `196771841`
- PRD: page `200966168`
- HLD v1.3 LOCKED: page `200769565`
- DLD Part 0–3: page `200769588`
- DLD Part 4–6: page `200966186`
- DLD Part 7–9: page `200835125`
- UI/UX Architecture: page `200933409`
- Final Phase-Wise Plan: page `201162773`
- Master Hardening Tracker: page `378699777`
- Phase 10 final validation: page `378077276`

### Important precedence note — adaptive video

The older DLD says Phase 1 has no ABR, while the PRD requires graceful video downgrade on poor networks. The later approved hardening work resolved this in favor of the higher-priority PRD requirement and implemented protected adaptive HLS for supported Cloudinary video. Final QA must therefore test the current adaptive behavior and must not treat the old `NO ABR` wording as the final acceptance contract.

### Phase-1 exclusions

Do not fail the release for absence of out-of-scope features and do not invent tests that imply they are required:

- third-party DSP distribution is not active in Phase 1;
- royalty calculation/payout automation;
- offline downloads;
- playlists/likes/comments/social/messaging;
- web fan application;
- AI recommendations/AI analytics.

Distribution domain readiness is tested only as inactive, provider-neutral future readiness.

## Current QA target

Always record the exact commit under test. At creation of this suite the hardened control branch is:

`fix/production-hardening-main @ 9b0f8c07511643c19e28de336719cd77ba4ba053`

Do not assume this remains current. Every execution report must capture the actual tested SHA.

## QA package index

| File | Area |
|---|---|
| `00-BUILD-RUN-ENVIRONMENT.md` | clean install, configuration, migrations, builds, startup, test data |
| `01-AUTH-IDENTITY-RBAC.md` | auth, sessions, account states, role boundaries, IDOR |
| `02-USER-FAN-ACCOUNT-LIBRARY.md` | fan account/profile, own transactions, library/recent activity |
| `03-ARTIST-CHANNEL.md` | artist onboarding/approval/profile/branding/pricing/content visibility |
| `04-CONTENT-MEDIA-LIFECYCLE.md` | upload, validation, provider callbacks, moderation, takedown |
| `05-STREAMING-PLAYBACK.md` | entitlement, protected playback, HLS/progressive, expiry, ABR, replay |
| `06-SUBSCRIPTIONS.md` | subscription lifecycle and access state |
| `07-PAYMENTS-REFUNDS.md` | Razorpay authority, webhook/idempotency, ledger, refund/reconciliation |
| `08-ADMIN-GOVERNANCE.md` | privileged admin/moderator/finance operations and destructive-action safety |
| `09-ANALYTICS-REPORTING.md` | trusted playback analytics, subscriber/revenue reporting, abuse resistance |
| `10-AUDIT-OBSERVABILITY.md` | immutable audit, structured logs, correlation, Sentry/redaction |
| `11-DISTRIBUTION-READINESS.md` | Phase-2-ready domain only; no live DSP submission |
| `12-PRIVACY-RETENTION-RECOVERY.md` | anonymization, media deletion queue, retention, backup/restore |
| `13-DATABASE-MIGRATIONS-CONFIG.md` | schema readiness, migrations, constraints, production config safety |
| `14-CLIENTS-MOBILE-WEB-UX.md` | Fan Android/iOS, Admin Web, Artist Web, UX state matrix |
| `15-NFR-SECURITY-PERFORMANCE-RESILIENCE.md` | security, performance, concurrency, failure injection, SLO/RTO/RPO evidence |
| `16-E2E-PRODUCTION-ACCEPTANCE.md` | final integrated journeys, release gate and GO/NO-GO |
| `TEST-EXECUTION-REPORT-TEMPLATE.md` | reusable evidence/report template |

## Mandatory test environments

Final acceptance must not run only on localhost or mocks. Use a production-like stage/UAT environment with:

- HTTPS API URL;
- Postgres created from canonical migrations;
- representative migrated data where migration compatibility is being tested;
- Razorpay test credentials and signed webhook path;
- real configured storage/media provider in test mode;
- Cloudinary webhook when Cloudinary/adaptive video is enabled;
- Admin Web production build;
- Artist Web production build;
- Android production-like artifact;
- iOS production-like artifact where credentials/devices are available;
- Sentry/error tracing configured for a QA release;
- Redis if production uses Redis; also verify safe behavior where Redis is optional;
- documented backup/snapshot mechanism.

Never put credentials, payment secrets, webhook secrets, signed URLs, access tokens, or customer data in this folder or screenshots.

## Standard test data

Prepare fresh, identifiable QA data. Suggested identities:

### Fans

- `FAN_FREE` — no paid entitlement.
- `FAN_ACTIVE_A` — active subscription to Artist A.
- `FAN_ACTIVE_B` — active subscription to Artist B.
- `FAN_EXPIRED` — expired entitlement.
- `FAN_REFUNDED` — payment refunded/revoked entitlement where applicable.
- `FAN_SUSPENDED` — inactive account.
- `FAN_DEVICE_LIMIT` — account at allowed device/session threshold.

### Artists

- `ARTIST_PENDING`
- `ARTIST_APPROVED_A`
- `ARTIST_APPROVED_B`
- `ARTIST_REJECTED`
- `ARTIST_SUSPENDED`

### Content

For both AUDIO and VIDEO where meaningful:

- approved/public-or-playable content;
- early-access/protected content;
- DRAFT/PENDING content;
- REJECTED content;
- TAKEN_DOWN content;
- PROCESSING media;
- FAILED media;
- low-resolution video with limited adaptive variants;
- higher-resolution adaptive video;
- migrated/legacy provider asset.

### Payments

- pending order;
- successful payment;
- failed payment;
- duplicate webhook event;
- stale/replayed webhook;
- refunded payment;
- ambiguous gateway/local state for reconciliation test.

## Test case format

Every executed case should record:

- **ID** — stable module prefix, e.g. `AUTH-NEG-004`.
- **Priority** — P0/P1/P2/P3.
- **Type** — Positive / Negative / Edge / Security / Concurrency / Recovery / UX / Performance.
- **Preconditions**.
- **Steps** — exact API/UI/device actions.
- **Expected result** — HTTP/UI/data/audit/log outcome.
- **Evidence** — request/response excerpt, DB query output, screenshot, device/build ID, or log correlation ID.
- **Result** — PASS / FAIL / BLOCKED / NOT RUN.
- **Defect** — issue/reference if failed.

## Evidence rules

A test does not pass merely because no error was seen.

For critical flows capture evidence from at least two layers where possible:

- user-visible result;
- authoritative backend/DB state;
- audit/log correlation;
- provider/gateway state for external integrations.

Examples:

- payment success = gateway test payment + local payment ledger + subscription entitlement + audit/reconciliation;
- takedown = admin UI/API + DB state + new stream access denied;
- session revocation = session row ended + API denied + client routed safely;
- adaptive playback = device/player network evidence + protected manifest/segment requests + no provider raw URL leak.

## Severity and release rules

### P0 — immediate NO-GO

Examples:

- auth/RBAC/IDOR bypass;
- paid content unlocked without authoritative entitlement;
- unauthorized protected media access;
- payment duplication/incorrect financial state;
- unverified webhook mutates state;
- data corruption/loss;
- exposed production secret/token/private signed URL;
- destructive admin action without authorization;
- migration can irreversibly corrupt active data.

### P1 — NO-GO until fixed

Examples:

- major PRD flow broken;
- build/store-critical mobile failure;
- unsafe production configuration fallback;
- unreliable migration or backup restore;
- takedown/revocation not effective;
- critical audit trail missing;
- upload can exhaust process memory or bypass validation.

### P2/P3

Can be considered for documented follow-up only if contractual behavior, security, money, entitlement, data integrity, store release, and critical UX are unaffected and the product owner accepts the limitation.

## Final release gate

Production/client delivery is **GO** only when all are true:

- clean installs and production builds succeed;
- canonical migrations apply on fresh DB and representative upgrade path;
- no P0/P1 defects remain;
- auth/session/IDOR matrices pass;
- payments/webhooks/refunds/reconciliation pass;
- content/media moderation and provider webhook matrices pass;
- protected playback/expiry/revocation/ABR tests pass;
- Android and iOS critical real-device matrices pass;
- Admin and Artist browser matrices pass;
- analytics/audit abuse tests pass;
- production configuration rejection tests pass;
- distribution-readiness model regression passes without enabling DSP delivery;
- privacy/deletion/retention behavior is proven against approved policy;
- backup restore drill succeeds with measured recovery time and recovery point;
- Sentry/logging trace and redaction checks pass;
- final report identifies exact SHA/build IDs and supports an explicit GO decision.

Merged code, screenshots of a happy path, or source-level contract tests alone are insufficient for final acceptance.
