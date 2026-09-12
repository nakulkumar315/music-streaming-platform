# AGENTS.md — Music Streaming Platform Engineering Contract

This file applies to the entire repository.

## 1. Project state

This project is **greenfield, still in development, and not deployed to real users**.

Do not preserve obsolete APIs, schema compatibility fallbacks, duplicate routes/services, mock production behavior, or historical implementation quirks merely because they exist in the repository. Backward compatibility is required only when the approved PRD, Deal Agreement, locked design documents, or an explicitly approved external contract requires it.

Prefer the cleanest canonical implementation suitable for a production-ready first deployment.

## 2. Authoritative documentation

Before changing code, read the relevant Confluence source documents. Scope and behavior are not to be invented from existing code.

Authoritative order:

1. Deal Agreement — Phase-1 contractual scope.
2. Product Requirements Document (PRD) — approved functional scope and NFRs.
3. Music Distribution to Other Platforms — Phase-2 boundary and distribution intent.
4. HLD v1.3 LOCKED — architecture/module boundaries.
5. DLD v1.3 Parts 0–9 — detailed implementation contracts.
6. Production-Safe UI/UX Architecture — client behavior and UX requirements.
7. FINAL Phase-Wise Feature Delivery & Deployment Plan — original vertical-slice acceptance expectations.
8. Greenfield Engineering & Remediation Execution Strategy — current engineering/remediation rules.
9. Architecture & Delivery Readiness Gap Assessment.
10. Assessment-to-Fix Traceability Matrix.
11. The active remediation phase page.
12. Music Streaming Hardening — Master Phase Tracker & Evidence Register (Confluence page 378699777).

When an older remediation instruction assumes a deployed legacy database or mandatory backward compatibility, the Greenfield Engineering Strategy overrides that assumption unless a higher-authority approved requirement explicitly requires compatibility.

## 3. Canonical phase tracking

Confluence phase numbers are authoritative. Historical Git branch/PR phase numbers do not always match them. Map work by **scope and acceptance criteria**, never by number alone.

Before starting any change:

- read the Master Phase Tracker;
- identify the single canonical owning phase;
- inspect whether the gap has already been implemented partially or fully;
- inspect all backend, mobile, admin-web and artist-web callers/consumers affected by the contract;
- do not duplicate a fix already owned by another phase.

A merged PR does not automatically mean a phase is complete.

Allowed phase statuses are:

- `NOT STARTED`
- `IN PROGRESS`
- `IMPLEMENTED — EVIDENCE/GAPS PENDING`
- `VERIFIED COMPLETE`
- `BLOCKED — DECISION REQUIRED`

Only use `VERIFIED COMPLETE` when the phase Definition of Done has code, automated/manual evidence, negative-path coverage and non-regression verification.

## 4. Branch workflow

Hardening integration branch:

`fix/production-hardening-main`

Create focused module branches from the latest integration head. Do not start from stale `main` or from another unfinished feature branch unless explicitly required.

One canonical phase/workstream at a time. Cross-phase improvements may be made when technically inseparable, but they must be recorded as partial evidence for the other phase rather than silently marking it complete.

Current remediation direction intentionally excludes GitHub Actions, branch-protection and CODEOWNERS work. Local build/type/test verification remains mandatory.

## 5. Architecture and coding rules

Follow these rules unless a locked design document explicitly says otherwise:

- Modular monolith; keep module boundaries clear.
- Controllers/routes own HTTP concerns, not core business rules.
- Domain/application services own business decisions and state transitions.
- Persistence/data-access code owns queries and transaction mechanics.
- One source of truth for pricing, entitlement, playback authorization, account state, publication state, payment/refund state and distribution readiness.
- Server is authoritative for price, role, status, verification, entitlement, preview policy, payment outcome and publication state.
- Fail closed for authorization/security/business state uncertainty.
- Fail fast on invalid required configuration or incompatible schema.
- Use typed boundary validation and stable error codes.
- Use explicit state machines for payments, refunds, subscriptions, content/moderation, media processing and future distribution lifecycle.
- Use transactions/locking/idempotency for financial, entitlement and concurrency-sensitive operations.
- Never `catch/log/continue` when continuation can create inconsistent security or financial state.
- Do not create parallel `new`, `v2`, `legacy`, `fallback` or alias implementations unless coexistence is an approved requirement.
- Remove dead/debug/test/mock production-reachable code rather than hiding it.
- Do not use missing-column/table exceptions such as `42703`/`42P01` as normal runtime compatibility logic.
- Do not expose raw media/provider URLs for protected content.
- Do not log secrets, tokens, signed URLs, payment signatures, sensitive provider keys or credential fragments.
- Keep abstractions practical: use provider interfaces at real seams such as payment, media storage/delivery and future distribution; avoid speculative layering.
- Preserve premium UX requirements and error/retry/loading behavior when backend contracts change.

## 6. Phase-2 distribution boundary

Phase 1 must be **distribution-ready**, but it must not implement Spotify/Apple Music/YouTube Music delivery or distributor APIs unless a new approved scope explicitly adds them.

Design the release/content domain so Phase 2 can later support:

- exclusivity end date;
- release type/lifecycle;
- distribution status;
- distributor reference/provider identity;
- external platform links;
- submission/retry/rejection/live state;
- provider adapters without redesigning subscription/streaming core.

Do not add royalty collection or artist payout responsibilities; those are outside the current distribution model.

## 7. Required workflow for every phase

1. Read the PRD/design pages and the active phase page completely.
2. Read the Master Phase Tracker and traceability matrix.
3. Inventory current routes/services/schema and all relevant client callers.
4. Record exact current behavior, duplicates and remaining gaps.
5. Choose one canonical target design consistent with the greenfield strategy.
6. Implement only the owned scope plus technically inseparable shared changes.
7. Delete obsolete/bypass/fail-open paths after the canonical path covers required behavior.
8. Add focused unit/integration/security tests where technically practical.
9. Run available local build, typecheck and relevant test commands.
10. Execute the phase manual/API/device checklist where applicable.
11. Review negative paths: manipulated input, unauthorized access, retries, duplicates, replay, timeout, partial failure, concurrency and recovery.
12. Re-read PRD/DLD acceptance criteria and perform a non-regression review across affected backend/mobile/web paths.
13. Update the individual Confluence phase page with evidence and remaining items.
14. Update the Master Phase Tracker status/evidence.
15. Merge only after the scope has been reviewed.

Never claim a command/test passed unless it was actually executed and the result is available.

## 8. Confluence evidence required per phase

Each phase page must record, at minimum:

- current status;
- integration baseline SHA;
- feature/fix branch and PR;
- root cause and gaps found;
- files changed;
- architecture/API/DB/config contract changes;
- obsolete/duplicate paths removed;
- tests added/updated;
- exact commands executed and results;
- manual/API/device results where required;
- authorization/security/concurrency/retry/failure checks;
- PRD/DLD non-regression confirmation;
- unresolved limitation or approved business decision;
- final reviewer status.

If a new gap is discovered that is not represented in the traceability matrix, add it to the matrix/tracker and assign one canonical owner before implementing it elsewhere.

## 9. Completion standard

The goal is not to make a demo work. The goal is a clean, coherent, production-ready first deployment that covers the full approved Phase-1 PRD and remains extensible for the approved future distribution phase.

Do not mark the overall project ready for client handover until the final regression/security/delivery phase confirms there are no unresolved P0/P1 issues and all mandatory PRD acceptance criteria are evidenced.
