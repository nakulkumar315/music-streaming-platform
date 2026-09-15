# 15 — NFR, Security, Performance, Resilience & Operational Readiness

## Scope

Covers Phase-1 non-functional requirements: security, availability/reliability, scalability direction, data integrity, performance, resilience, observability/supportability, legal-safety boundaries, and evidence against HLD engineering targets.

## HLD engineering targets to measure

- API availability target: 99.5% (engineering target, not contractual SLA).
- stream-token/access issuance success target: 99.5%.
- payment webhook processing success target: 99.5%.
- crash-free mobile sessions: 99%+ target.
- takedown effect for new stream access: near-immediate.
- RTO target: 4 hours.
- RPO target: 15 minutes.

Do not mark these achieved without measured evidence from a representative environment.

## Security test domains

### Authentication/RBAC/IDOR

Execute full matrices in `01-AUTH-IDENTITY-RBAC.md` and `08-ADMIN-GOVERNANCE.md`.

### Media protection

Execute direct/replay/expiry/revocation tests in `05-STREAMING-PLAYBACK.md`.

### Payment/webhook authenticity

Execute `07-PAYMENTS-REFUNDS.md`.

### Upload security

Execute MIME/magic-byte/path/size/provider-forgery matrix in `04-CONTENT-MEDIA-LIFECYCLE.md`.

### XSS/injection/input abuse

Across Web/API inputs test:

- `<script>` and common event-handler strings;
- `javascript:` URLs;
- HTML/SVG payload strings;
- SQL metacharacters;
- JSON nesting/large strings;
- invalid Unicode/control chars;
- path traversal strings;
- CRLF/log injection in correlation/header/input fields.

Expected: inputs remain data, are validated/encoded, do not execute/alter SQL/log structure.

### Headers/CORS/TLS

In production-like staging verify:

- HTTPS only for public clients;
- explicit CORS allowlist;
- disallowed origin blocked for browser preflight;
- `X-Content-Type-Options: nosniff`;
- safe referrer policy;
- no sensitive token in URL/referrer;
- storage/public media policy matches asset type;
- no direct private storage listing.

## API performance baseline

Use a controlled load tool such as k6, autocannon, Artillery or equivalent. Do not run aggressive load against production without approval.

Measure p50/p95/p99, error rate and resource usage for:

- health/readiness;
- browse artist/content;
- search;
- login;
- subscription status;
- playback access issuance;
- analytics heartbeat/event;
- Admin content listing;
- Artist analytics summary.

Test at gradually increasing concurrency representative of expected launch, not arbitrary internet-scale numbers.

Record:

- request rate/concurrency;
- p50/p95/p99;
- error rate;
- CPU/memory;
- DB connections/query symptoms;
- provider latency where external.

Any severe latency amplification, connection exhaustion or memory growth should become a defect even if exact capacity target is not contractually defined.

## Upload resource resilience

Upload several reasonably large allowed files concurrently.

Verify:

- process memory remains bounded because files are streamed/spooled rather than buffered unboundedly;
- temp files are cleaned after success/failure;
- one failed upload does not crash process;
- provider slowdown generates backpressure/timeouts rather than OOM;
- upload limits are enforced before dangerous processing.

## Payment webhook burst

Send a controlled burst of:

- unique valid test events;
- duplicate valid events;
- invalid signatures.

Measure processing latency/error rate and verify idempotency. DB must not create duplicate subscriptions/payments.

## Analytics burst/abuse

Generate high-frequency heartbeat/events from QA sessions. Verify deduplication/bounding and that core playback latency remains acceptable.

## Failure injection matrix

### Database unavailable

Expected:

- readiness 503;
- auth/payment/access/admin mutations fail closed;
- no fabricated fallback data grants privilege;
- service recovers after DB returns.

### Redis unavailable

Expected: optional-cache degradation follows current design; DB authorization truth remains correct; no stale cached entitlement grants access.

### Storage/media provider unavailable

Expected: upload/playback refresh fails clearly; content is not falsely marked ready/published; app remains stable.

### Razorpay unavailable/timeout

Expected: no paid entitlement; purchase remains failed/pending/reconcilable; user gets truthful UX.

### Sentry unavailable

Expected: application core behavior continues; local structured logs remain useful.

### Worker restart/concurrency

Run cleanup/aggregation/deletion jobs concurrently/restart mid-work. Claims/idempotency must prevent double effects.

## Mobile resilience

On low/mid Android plus iOS where available:

- 3G/slow bandwidth profile;
- high latency/packet loss;
- Wi-Fi ↔ cellular;
- app background/foreground;
- lock screen;
- audio interruption/call;
- low-memory process recreation where practical;
- long playback session;
- repeated video quality transitions.

Record crash/ANR/player failures and Sentry events.

## Data integrity stress

Under concurrency test:

- duplicate subscription purchase;
- duplicate payment webhook;
- simultaneous admin moderation;
- refund + playback refresh;
- session revoke + API request;
- takedown + media callback;
- privacy deletion worker concurrency.

Verify DB constraints and transactions preserve one coherent final state.

## Availability/startup behavior

- start multiple backend instances against migrated DB;
- restart instance during traffic;
- rolling-style restart in staging if deployment platform allows;
- verify stateless request handling except explicitly externalized session/cache state;
- verify no startup race runs schema mutation.

## Cache/CDN behavior

- `/stream/access` responses must be private/no-store;
- protected manifests/resources must not become publicly cacheable in a way that bypasses authorization;
- artwork/public assets may use safe cache headers according to design;
- stale browser/client data cannot bypass backend access checks.

## Legal/scope safety checks

Verify product/UI does not claim:

- platform ownership of artist content;
- royalty collection/payout service;
- role as music label/distributor in Phase 1;
- active DSP distribution when only readiness exists.

Takedown controls must support policy/legal enforcement.

## Recovery measurement

Use restore drill in `12-PRIVACY-RETENTION-RECOVERY.md` to measure actual RTO/RPO evidence. Compare measured result with HLD targets and record PASS/FAIL/GAP rather than assuming provider capability equals compliance.

## Exit criteria

No security bypass exists; representative load has no obvious launch-blocking bottleneck/OOM/connection collapse; dependency failures fail closed and recover; mobile remains stable on poor networks; cache/CDN does not weaken authorization; and HLD operational targets have measured evidence or explicitly recorded gaps.
