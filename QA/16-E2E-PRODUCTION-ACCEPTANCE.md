# 16 — End-to-End Production Acceptance & GO/NO-GO

## Purpose

This is the final integrated gate. Run it only after the individual module plans are substantially executed and all known P0/P1 defects from those plans are fixed and rerun.

A source build passing is necessary but not sufficient. Final acceptance requires production-like environment, real test integrations, physical-device evidence, migration/recovery evidence and cross-module consistency.

## Entry criteria

- exact candidate SHA frozen;
- clean backend/Admin/Artist/Mobile verification complete;
- fresh and upgrade migrations pass;
- staging uses HTTPS and production-like config;
- Razorpay test webhook reachable;
- media provider webhook reachable where used;
- representative test data exists;
- Android artifact installed on physical device;
- iOS artifact installed on physical device where credentials/device available;
- Sentry/logging correlation visible;
- no open P0/P1 from module QA.

## E2E-01 — New Fan → Paid Early Access → Playback

1. Fresh-install Fan app.
2. Sign up/login.
3. Discover approved Artist A.
4. Open protected audio/video; verify Early Access locked state.
5. Subscribe using Razorpay test payment.
6. Verify client shows Pending/Confirming before webhook truth.
7. Verify one captured payment/local ledger result.
8. Verify one active artist entitlement.
9. Refresh content; locked item becomes accessible.
10. Play audio then video.
11. Verify trusted analytics event/count.
12. Verify Artist subscriber/revenue summary and Admin reporting eventually reconcile.

**PASS:** no false unlock before webhook; one financial/entitlement result; protected playback only after activation.

## E2E-02 — Payment Failure / Cancellation

Repeat purchase but fail/cancel gateway.

**PASS:** no active entitlement, no protected playback, truthful UI, local financial state reconcilable.

## E2E-03 — Webhook Delay / App Kill Recovery

1. Start payment.
2. Kill/background app after gateway success.
3. Deliver webhook later.
4. Relaunch.

**PASS:** app reconciles to backend active state; no duplicate purchase required; no false state while webhook pending.

## E2E-04 — Artist Lifecycle

1. Submit Artist application.
2. Verify pending state cannot use verified APIs.
3. Admin reviews/approves.
4. Artist logs in to active dashboard.
5. Update bio/banner/accent/social profile.
6. Set valid pricing.
7. Verify Fan channel branding/pricing.
8. Admin suspends artist.
9. Verify Artist protected actions and public behavior follow approved suspension policy.

**PASS:** no self-approval, no cross-role bypass, branding/pricing converge across clients.

## E2E-05 — Admin Content Lifecycle

1. Admin uploads valid audio/video/artwork.
2. Provider processing completes.
3. Content remains non-public pending governance.
4. Admin approves/tag early access.
5. Eligible Fan plays.
6. Admin takedowns with reason during active playback.
7. New access/resource refresh is denied.
8. Artist history/Admin state/audit reflect takedown.

**PASS:** technical READY never bypasses approval; takedown is near-immediate for authorization.

## E2E-06 — Expiry

1. Use subscription configured/adjusted to expire during test.
2. Play protected content before expiry.
3. Cross expiry boundary.
4. Request new access/refresh.

**PASS:** backend server time/state relocks access; device clock does not control eligibility; client shows renew/access-lost UX.

## E2E-07 — Refund

1. Complete paid subscription.
2. Admin/Finance performs allowed refund.
3. Confirm provider and local refund state.
4. Verify subscription/access effect per current policy.
5. Attempt playback.
6. Verify financial/report/audit/reconciliation consistency.

**PASS:** no contradictory gateway/local/entitlement state.

## E2E-08 — Session Revocation

1. Fan logs in on two allowed devices.
2. Revoke one/all sessions through supported action.
3. Attempt profile, payment and stream access from revoked device.

**PASS:** revoked session cannot continue sensitive/API/media access; active intended session behavior remains correct.

## E2E-09 — IDOR Attack Journey

Using normal client tokens and direct HTTP calls:

- Fan A attacks Fan B invoices/sessions/subscriptions/playback session;
- Artist A attacks Artist B profile/pricing/analytics/release metadata;
- Moderator attacks refund;
- Finance attacks content moderation;
- Artist/Fan attacks Admin API.

**PASS:** all denied, no partial data leak/mutation.

## E2E-10 — Adaptive Poor-Network Video

1. Play high-resolution adaptive video on Auto.
2. Throttle network.
3. Observe downgrade/continued playback.
4. Restore bandwidth.
5. Change to available manual variant.
6. Attempt unavailable higher variant.
7. Inspect network for raw provider URL leakage.

**PASS:** source-aware variants only; unavailable quality rejected; protected proxy/session rules maintained.

## E2E-11 — App/Network Interruption

For Android and iOS:

- audio background/lock screen;
- Bluetooth/headset;
- phone-call interruption;
- Wi-Fi/cellular switch;
- no network and reconnect;
- app background beyond token TTL;
- cold/warm restart.

**PASS:** no crash, unauthorized access or irrecoverable player state.

## E2E-12 — Analytics Failure Isolation

Break analytics persistence/service in QA while playing authorized media.

**PASS:** playback remains functional; analytics error observable; no financial/access state affected.

## E2E-13 — DB/Provider Failure Safety

Test separately:

- DB unavailable during entitlement/payment/admin mutation;
- storage provider unavailable during upload;
- media provider unavailable during playback refresh;
- Razorpay timeout;
- Redis unavailable.

**PASS:** no fail-open entitlement/privilege/payment; failure is clear and service recovers when dependency returns.

## E2E-14 — Privacy Anonymization

Execute on dedicated QA identity with history.

**PASS:** access revoked and profile PII anonymized; payment/subscription/audit/content lineage remains coherent; media deletion queued.

## E2E-15 — Physical Media Deletion

Takedown then queue deletion for dedicated QA asset.

**PASS:** playback already denied at takedown; provider deletion status progresses through pending/retry/confirmed without falsely claiming deletion early.

## E2E-16 — Backup Restore

Execute isolated restore drill from `12-PRIVACY-RETENTION-RECOVERY.md`.

**PASS:** restored app starts and representative relationships are usable; measured RTO/RPO recorded.

## E2E-17 — Distribution Readiness Non-Regression

Verify release/track/contributor/external-link data can exist without any DSP network integration and without changing Phase-1 playback/entitlement.

**PASS:** future-ready but inactive.

## E2E-18 — Production Build/Config

Verify final artifacts from clean install:

- backend build and `npm run verify`;
- Admin Web `npm run verify`;
- Artist Web `npm run verify`;
- Mobile `npm run verify` and production-like artifacts;
- invalid production configuration fails startup/build validation;
- no CI/GitHub Actions are required for this manual hardening acceptance process.

## Browser/device minimum matrix

Record actual versions tested.

- Android physical device: at least one low/mid-range and one representative modern device where possible.
- iOS physical device: at least one supported iPhone model where available.
- Admin Web: Chrome + one additional modern browser.
- Artist Web: Chrome + one additional modern browser.

## Final security sweep

Before GO, manually inspect/request-test:

- removed debug/test routes;
- raw media/provider URL leakage;
- auth/session token leakage;
- hard-coded/default production secrets;
- wildcard CORS/localhost production URLs;
- direct admin endpoint access;
- webhook signature bypass;
- client amount/price trust;
- fail-open DB helper/fallback behavior on security/business paths;
- runtime DDL;
- stored/reflected XSS on privileged Web surfaces.

## Store readiness

Android/iOS acceptance should include:

- release identity/version/build numbers;
- permissions only as needed;
- production HTTPS endpoints;
- privacy/support metadata supplied outside code where store requires it;
- background playback behavior consistent with platform policy;
- no dev menus/test credentials/test banners;
- crash-free launch and critical flow.

Store submission/acceptance evidence should be recorded if final contractual delivery requires store-ready/accepted builds.

## GO decision rules

### GO

Only when:

- every P0/P1 matrix is PASS;
- exact release SHA/builds recorded;
- payment/media security evidence complete;
- migrations/recovery proven;
- physical-device critical flows pass;
- no unresolved contractual/PRD critical gap;
- final report reviewed by technical owner and QA/reviewer.

### NO-GO

Any open P0/P1, unverified payment/media authorization, failed production build, unsafe migration, missing restore proof, or critical Android/iOS failure keeps the release NO-GO.

## Deliverables

Use `TEST-EXECUTION-REPORT-TEMPLATE.md` to produce the signed-off final report containing:

- tested SHA;
- environment/build IDs;
- migration version;
- test data summary;
- per-module PASS/FAIL totals;
- defect list;
- screenshots/log evidence references;
- payment/media/migration/restore evidence;
- device/browser matrix;
- unresolved limitations/approved decisions;
- final GO/NO-GO recommendation.
