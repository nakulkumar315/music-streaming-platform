# 14 — Fan Mobile, Admin Web, Artist Web & Premium UX

## Scope

Covers client build/runtime configuration, screen-state completeness, navigation/session behavior, mobile real-device playback/payment flows, Admin/Artist browser behavior, accessibility/usability basics, slow-network resilience and the PRD/UI architecture requirement for a calm, premium, trustworthy experience.

## General UX rule

Every meaningful screen must be exercised in:

1. Loading
2. Empty
3. Error
4. Success

Critical flows such as auth, payment and playback must use explicit progress/state messaging rather than misleading skeletons or silent transitions. Every error/empty state must provide a clear next action where one exists.

## A. Fan Mobile — clean build gate

```bash
cd mobile
npm ci
npm run verify
npx expo-doctor
npm run android
npm run ios
```

Final acceptance requires production-like Android and iOS artifacts on physical devices where possible. Record:

- app version/build number;
- git SHA;
- device model;
- OS version;
- network type.

## Fan Mobile screen inventory

Validate implemented Phase-1 equivalents of:

- splash/session restore;
- welcome/onboarding if present;
- signup/login;
- Home/Discover;
- Search/Artist listing;
- Artist Channel;
- Content Detail;
- Audio Player;
- Video Player;
- persistent Mini Player;
- Subscription Offer;
- Payment Processing/Pending/Success/Failed;
- Subscription/Library;
- Account;
- no-network/session-expired/suspended/access-lost states.

Out-of-scope features such as offline downloads should not create misleading functional controls.

## Mobile positive journey

Execute on Android and iOS:

`fresh install → signup/login → discover artist → open channel → inspect locked content → subscribe → Razorpay test payment → pending confirmation → active unlock → play audio → navigate with mini player → play video → background/foreground → account/library → logout`

Capture evidence at each backend-authoritative boundary.

## Mobile negative/edge cases

- cold start offline;
- login network timeout;
- app killed during login/session restore;
- token revoked while app open;
- scroll large artist/content list;
- image fails to load;
- content disappears due to takedown while detail open;
- subscription expires/refunds while player open;
- Razorpay app/browser cancelled;
- app killed immediately after gateway success;
- webhook delayed;
- network switch during payment status polling;
- audio network drop/reconnect;
- video weak bandwidth/ABR adaptation;
- app background longer than media access TTL;
- phone call/audio focus interruption;
- Bluetooth connect/disconnect;
- rotate video fullscreen;
- low-memory/background process recreation where practical;
- rapid taps on Subscribe/Play/Retry;
- system font scaling and small screen;
- dark-mode-first readability.

Expected: no crash, no false payment success, no stale unauthorized playback, no dead-end screen.

## Mobile security/config

- no cleartext production API traffic;
- no localhost/10.0.2.2 URL in release build;
- no auth/media token printed in console/logcat;
- no dev/test/debug route exposed in UI;
- protected media not persisted as offline downloadable file;
- screenshots/network logs do not reveal raw provider media URL;
- release Sentry points to correct environment/release where configured.

## Mobile premium UX checks

- artwork is primary, typography readable;
- locked item clearly says Early Access/why locked/how to unlock;
- subscription copy communicates artist support/early access without misleading guarantees;
- payment returns to `Confirming…` until backend truth;
- buffering/reconnecting is visible but non-alarming;
- retry preserves context/position where safe;
- animations do not cause noticeable jank on low/mid Android hardware;
- mini player does not unexpectedly reset on tab navigation;
- loading states avoid layout jumps where practical.

---

## B. Admin Web

Build:

```bash
cd web-admin
npm ci
npm run verify
npm run build
npm run preview
```

Browser matrix: latest supported Chrome plus at least one additional modern browser (Firefox/Edge/Safari as practical).

Validate:

- login/logout/session expiry;
- direct protected route;
- dashboard loading/error/empty;
- Artist list/detail/actions;
- upload/moderation/takedown;
- user management;
- subscriptions/payments/refunds;
- pricing;
- analytics;
- audit logs;
- browser refresh/deep link;
- duplicate mutation click;
- stale form conflict;
- user-entered script-like text rendering;
- network throttling/offline/reconnect;
- no localhost API calls in production build;
- no sensitive token in URL/browser logs.

Destructive/financial actions must have explicit confirmation/reason behavior as required by current UI contract.

---

## C. Artist Web

Build:

```bash
cd web-artist
npm ci
npm run verify
npm run build
npm run preview
```

Test account routing for:

- unauthenticated;
- pending/under review;
- rejected;
- suspended/inactive;
- approved/active.

Approved Artist screens:

- overview;
- profile/branding;
- profile/banner asset upload;
- read-only content/history;
- pricing;
- analytics/earnings;
- account/security/support;
- channel-preview summary if present.

Negative:

- manipulate route to approved dashboard while pending;
- change Artist B ID in request;
- submit privileged profile fields;
- stale browser after admin suspension;
- pricing double-submit/stale override;
- invalid social links/accent/input XSS strings;
- provider image upload failure;
- session expiry mid-save.

Expected: server state wins, UI clearly explains state, and no blank/partially privileged page remains usable.

## Cross-client consistency

Perform one change and verify all relevant clients converge:

- Admin approves Artist → Artist Web active + Fan discovery visible;
- Artist branding update → Fan channel shows current branding;
- Admin takedown → Fan playback denied + Artist status/history reflects it;
- Artist/Admin price change → Fan offer/new order uses server current price;
- payment success → Fan Library/unlock + Artist/Admin subscriber/revenue eventually correct;
- suspension → corresponding client loses protected access.

## Accessibility/usability baseline

Without expanding scope into a full WCAG certification, verify:

- interactive controls have readable labels;
- keyboard navigation works on critical Web forms/actions;
- focus is visible;
- modal focus/escape behavior does not trap users incorrectly;
- sufficient contrast for primary text/status badges;
- tap targets are usable on mobile;
- critical status is not communicated by color alone;
- screen rotation/safe areas do not hide controls.

## Exit criteria

All three clients build in production mode, enforce server state rather than UI assumptions, cover loading/empty/error/success states, survive slow/offline/session changes without crashes or false success, and provide consistent premium Phase-1 behavior across Android, iOS and supported browsers.
