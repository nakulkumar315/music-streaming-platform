# 01 — Authentication, Identity, Sessions & RBAC

## Requirement basis

Covers HLD Auth & Identity, DLD Part 3, Fan account/session requirements, Artist/Admin authentication, Phase 03 hardening, and Phase 10 authorization/IDOR matrices.

Core rules:

- authentication is server-authoritative;
- 401 = missing/invalid/expired authentication;
- 403 = authenticated but unauthorized;
- account state is enforced server-side;
- role checks are not UI-only;
- sessions can be revoked;
- Admin/Finance/Moderator/Artist/Fan privilege boundaries must hold;
- no debug/test route may provide authentication or privileged access in production.

## Build/source gates

Run from `backend`:

```bash
npm run test:auth-hardening
npm run test:auth-account-state-contract
npm run test:artist-ownership-contract
npm run test:artist-approval-contract
npm run test:auth-db
npm run verify
```

Also run Admin/Artist/Mobile verification from `00-BUILD-RUN-ENVIRONMENT.md` because client routing/session handling is part of auth acceptance.

## Positive functional cases

| ID | Scenario | Expected |
|---|---|---|
| AUTH-POS-001 | Fan signup with valid unique credentials | account created in valid initial state; password stored hashed; response contains no password/hash |
| AUTH-POS-002 | Fan login with valid credentials | authenticated session/token issued; session record/device identity created as designed |
| AUTH-POS-003 | App restart with valid session | session restores without login-screen flash or privilege loss |
| AUTH-POS-004 | Explicit logout | current session becomes unusable immediately |
| AUTH-POS-005 | Password change with correct old password | password changes; old credentials no longer work; session behavior matches approved security rule |
| AUTH-POS-006 | Approved Artist login | artist can access only Artist-authorized surfaces |
| AUTH-POS-007 | Admin login | admin can access admin-only surface |
| AUTH-POS-008 | Finance login | finance can view/refund financial functions but not moderate content |
| AUTH-POS-009 | Moderator login | moderator can moderate content but cannot refund/manage finance |
| AUTH-POS-010 | Correlation ID supplied by client | response/logs retain a safe correlation ID trace |

## Authentication negative cases

| ID | Scenario | Expected |
|---|---|---|
| AUTH-NEG-001 | protected API without token/session | 401; no business data |
| AUTH-NEG-002 | random/garbled token | 401; no stack trace |
| AUTH-NEG-003 | expired token/session | 401; client routes to session-expired/re-login state |
| AUTH-NEG-004 | token signed with wrong secret | 401 |
| AUTH-NEG-005 | token payload role changed client-side | signature fails or authoritative role prevents privilege |
| AUTH-NEG-006 | valid Fan calls Admin endpoint | 403 |
| AUTH-NEG-007 | valid Artist calls Admin endpoint | 403 |
| AUTH-NEG-008 | Moderator calls refund endpoint | 403 |
| AUTH-NEG-009 | Finance calls content approval/takedown endpoint | 403 |
| AUTH-NEG-010 | Admin/Artist/Fan attempts removed debug/test auth route | 404/forbidden; never privileged success |
| AUTH-NEG-011 | wrong password | generic authentication error; no account enumeration details beyond approved UX |
| AUTH-NEG-012 | malformed email/password payload | deterministic validation error; no DB error leak |
| AUTH-NEG-013 | deleted/anonymized account login | denied |
| AUTH-NEG-014 | suspended/inactive account login or protected request | denied server-side even with previously valid token |
| AUTH-NEG-015 | rejected/pending Artist attempts verified-only API | denied |

## Session lifecycle and device cases

| ID | Scenario | Expected |
|---|---|---|
| AUTH-SES-001 | same user logs in on allowed number of devices | all allowed sessions function |
| AUTH-SES-002 | exceed configured device/session limit | deterministic safe denial or oldest-session policy exactly as implemented/approved; never unlimited bypass |
| AUTH-SES-003 | revoke one session | only intended session is revoked unless account-wide action is requested |
| AUTH-SES-004 | revoke all/account suspend | all active sessions become unusable |
| AUTH-SES-005 | race: request arrives while session revoked | subsequent authorization fails; no long-lived stale authorization cache |
| AUTH-SES-006 | password change while another device active | verify approved session invalidation policy and document result |
| AUTH-SES-007 | device ID missing/malformed when required | request rejected; server does not silently invent unsafe identity |
| AUTH-SES-008 | forged device ID of another user/session | no session takeover |
| AUTH-SES-009 | concurrent login attempts | no duplicate/invalid session corruption |
| AUTH-SES-010 | Redis unavailable | authoritative auth/account state must not fail open |

## Account state matrix

Run each state with both a fresh login and an already-issued token:

- ACTIVE Fan;
- SUSPENDED Fan;
- deleted/soft-deleted Fan;
- anonymized account;
- PENDING Artist;
- APPROVED Artist;
- REJECTED Artist;
- SUSPENDED Artist.

For each state test:

1. login;
2. profile endpoint;
3. content/browse access;
4. subscription/payment initiation;
5. stream-access issuance;
6. privileged Artist endpoint where applicable.

Expected: server-side account state remains authoritative even if client caches stale UI state.

## IDOR / ownership security matrix

### Fan A vs Fan B

Using Fan A authentication, directly request Fan B identifiers for:

- profile/private account detail;
- transactions/invoices;
- sessions/devices;
- subscription detail;
- playback session/resource token;
- any private analytics/history endpoint.

Expected: 403/404 according to anti-enumeration design; never Fan B data.

### Artist A vs Artist B

Artist A must not:

- edit Artist B profile or branding;
- change Artist B pricing;
- read Artist B private earnings/analytics;
- alter Artist B release/distribution metadata;
- upload/associate content as Artist B;
- access Artist B protected operational data.

### Role injection

Attempt request bodies/query params containing `role=ADMIN`, `userId=<other>`, `artistId=<other>` and equivalent fields. The server must derive acting identity/role from authenticated context and validate target ownership separately.

## Token/logging security

Verify logs/Sentry do not contain:

- Authorization header;
- JWT/access token;
- password or password hash;
- session secret/device token;
- signed media token/query string;
- signature encryption key;
- Razorpay secrets.

Trigger one controlled auth error and find it by correlation ID without sensitive material.

## Rate/abuse cases

- burst invalid login attempts from one IP;
- burst authenticated token requests from one user;
- distributed-style attempts across two test accounts;
- repeated session-creation requests;
- large malformed auth payload.

Expected: configured limiter prevents obvious abuse while normal login is still usable; limiter failure must not grant privilege.

## Client UX checks

### Mobile

- silent restore does not flash unauthorized screen;
- expired/revoked session routes to login with understandable message;
- background/foreground after revocation does not keep privileged cached screen functional;
- no token printed to console/logcat.

### Admin/Artist Web

- direct URL to protected route without session redirects safely;
- browser back after logout does not restore functional protected data;
- stale tab after server revocation fails API call and returns to safe account/login state;
- browser storage does not persist sensitive session data beyond current approved design.

## Edge/failure cases

- DB temporarily unavailable during login: 5xx, never a fabricated success;
- session-table write fails after password verification: login must fail atomically rather than issuing untracked access;
- account suspended between authentication and sensitive operation: operation denied by current-state check where required;
- clock near token expiry boundary: deterministic expiry behavior;
- duplicate logout/revoke request: idempotent safe result;
- Unicode/very long identity inputs: validation, no SQL/log corruption.

## Exit criteria

PASS only when role boundaries, ownership, session revocation and account states are proven through direct API tests plus client behavior; all P0/P1 failures are fixed and rerun; and no auth/debug fallback can grant access when DB/config/session checks fail.
