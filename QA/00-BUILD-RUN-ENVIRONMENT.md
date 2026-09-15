# 00 — Clean Build, Run & Test Environment

## Objective

Prove that the repository can be installed, migrated, built and run from a clean machine/environment without relying on hidden developer state, stale generated files, localhost production fallbacks, or previously-created database objects.

## Required evidence header

Record before testing:

- Git branch and exact SHA.
- OS and version.
- Node and npm versions.
- Java/Android SDK versions for Android.
- Xcode/macOS/CocoaPods versions for iOS.
- Database host/environment and DB name alias (never credentials).
- storage provider and mode.
- Razorpay mode (`test`, never live for QA unless explicitly approved).
- web URLs and mobile build IDs.
- schema/migration version.

## 1. Clean repository preparation

From repository root:

```bash
git status
git rev-parse HEAD
git clean -ndx
```

Do not run destructive `git clean -fdx` unless the local workspace is known disposable. QA evidence should show that generated/stale local files are not required.

## 2. Backend clean install and verification

```bash
cd backend
npm ci
npm run typecheck
npm run build
npm run test:unit
npm run verify
```

`npm run verify` is the primary source-level regression gate and currently includes payment, refund, storage identity, playback access/session, auth/account state, artist ownership/approval, content/media governance, runtime config/API, privileged web contracts, pricing/admin validation, Phase 08 operations, Phase 09 distribution readiness, Phase 09A adaptive media, Phase 09B privacy/recovery and Phase 10 final hardening contracts.

### Database-specific backend checks

With a disposable/QA DB configured:

```bash
npm run db:migrate:status
npm run db:migrate
npm run db:schema:check
npm run db:migrate:status
```

Then run DB-backed suites that are safe for the QA DB:

```bash
npm run test:auth-db
npm run test:refund-integrity-db
```

Provider checks as applicable:

```bash
npm run test:storage
npm run report:cloudinary-mapping
npm run report:refund-reconciliation
```

Do not run destructive privacy/deletion or real backfill commands against production. Use an isolated QA DB/provider namespace.

## 3. Backend configuration

Start from `backend/.env.example`; never commit populated secrets.

Production-like QA should validate at least:

- `NODE_ENV=production` behavior in a controlled staging instance;
- explicit HTTPS `APP_BASE_URL`;
- explicit HTTPS `CORS_ALLOWED_ORIGINS` without `*`;
- explicit `TRUST_PROXY_HOPS` appropriate to staging proxy topology;
- required `DATABASE_URL`;
- independent long values for `JWT_SECRET`, `SIGNATURE_ENCRYPTION_KEY`, `MEDIA_SIGNED_TOKEN_SECRET`;
- non-local production storage provider;
- valid Cloudinary/S3/Firebase settings for chosen provider;
- explicit Razorpay test keys and webhook secret when subscriptions enabled;
- valid upload limits and media TTL.

### Negative configuration matrix

Expected startup must fail for production mode when applicable:

| ID | Mutation | Expected |
|---|---|---|
| ENV-NEG-001 | missing `DATABASE_URL` | startup fails before serving traffic |
| ENV-NEG-002 | missing `JWT_SECRET` | startup fails |
| ENV-NEG-003 | placeholder/short production signing secret | startup fails |
| ENV-NEG-004 | production `CORS_ALLOWED_ORIGINS=*` | startup fails |
| ENV-NEG-005 | production `APP_BASE_URL=http://...` | startup fails |
| ENV-NEG-006 | production `APP_BASE_URL` localhost | startup fails |
| ENV-NEG-007 | production `STORAGE_PROVIDER=local` | startup fails |
| ENV-NEG-008 | Cloudinary selected with missing provider credentials/webhook URL | startup fails |
| ENV-NEG-009 | subscriptions enabled with missing Razorpay secret | startup fails |
| ENV-NEG-010 | invalid/non-numeric/unsafe TTL or upload limit | startup fails |

## 4. Backend runtime smoke

Development:

```bash
npm run dev
```

Production-like local/stage artifact:

```bash
npm run build
npm start
```

Validate:

- `/health` and `/health/live` respond without leaking dependency details;
- `/health/ready` is 200 only when DB is ready;
- correlation ID is returned/traceable;
- unknown routes return standardized 404 behavior;
- server errors do not expose stack traces in production mode;
- logged request path does not retain secret query strings;
- shutting down/restarting does not mutate schema or create runtime DDL.

## 5. Admin Web

```bash
cd web-admin
npm ci
npm run verify
npm run build
npm run preview
```

Acceptance:

- configuration validation runs before production build;
- TypeScript errors fail build;
- production bundle does not silently target localhost;
- auth token/session behavior matches current hardened design;
- direct refresh of protected routes behaves safely;
- browser console has no uncaught errors on critical flows.

## 6. Artist Web

```bash
cd web-artist
npm ci
npm run verify
npm run build
npm run preview
```

Acceptance is the same as Admin Web plus artist account-state routing: pending/rejected/suspended/approved users must land in the correct state and protected pages must not become accessible from client-side route manipulation.

## 7. Fan Mobile

```bash
cd mobile
npm ci
npm run verify
npx expo-doctor
```

Development/native runs:

```bash
npm run android
npm run ios
```

Final acceptance must use production-like artifacts, not only Expo development mode. Record exact artifact/build identifier.

### Mobile configuration negative checks

- missing API URL;
- HTTP API URL in production-like config;
- localhost/10.0.2.2 accidentally packaged for release;
- missing required mobile Razorpay public key/config when purchase flow enabled;
- Sentry disabled/misconfigured in the candidate build when release monitoring is required;
- dev menu/debug/test screens reachable from release UI.

## 8. Fresh DB migration test

Create an empty disposable database and run only canonical migration tooling.

Expected:

1. all migrations apply in order without manual SQL patches;
2. schema readiness passes;
3. application starts;
4. seed/test data can be created through supported mechanisms;
5. key constraints exist;
6. no runtime request path tries to create/alter tables.

## 9. Upgrade migration test

Restore a representative pre-hardening/earlier schema snapshot into an isolated DB and apply canonical migrations.

Verify:

- user/account identity preserved;
- content ownership preserved;
- payment/subscription references preserved;
- media/provider identity preserved;
- audit history preserved;
- distribution backfill does not change Phase-1 playback semantics;
- adaptive migration marks existing videos for safe processing rather than inventing fake renditions;
- privacy/recovery migration is additive and does not delete existing financial/audit history.

## 10. Minimum test fixtures before module QA

Create all identities/content/payment states described in `README.md` and record their IDs in a private execution sheet. Do not hardcode them into repository files.

Before moving to module testing, prove:

- one free fan can log in;
- one approved artist exists;
- one admin, finance and moderator identity exists if supported by current auth model;
- at least one approved audio and video exist;
- at least one protected item exists;
- at least one active and expired subscription exist;
- provider callbacks can reach staging;
- Razorpay test webhook can reach staging;
- log/Sentry correlation can be observed.

## Exit criteria

This environment gate passes only if clean installation/builds succeed, canonical migrations are repeatable, required external test integrations are reachable, production config rejects unsafe defaults, and all later QA can execute without developer-local hidden state.
