# Phase 05A Runtime / Configuration / API Quality Verification

This file records repeatable verification commands for the greenfield hardening branch. It is not evidence that the commands were executed by the repository connector.

## Automated source/build checks

```bash
cd backend
npm run verify
```

`verify` performs Prisma generation, fatal TypeScript compilation, and the source/config contract suites including `test:runtime-config` and `test:runtime-api-contract`.

## Fresh runtime checks required before VERIFIED COMPLETE

1. Start with a disposable migrated PostgreSQL database and valid production-like configuration; `/health/ready` must be 200 before normal traffic is accepted.
2. Start with an unmigrated/incompatible database; the listener must never become ready.
3. Start with unsafe production values (localhost `APP_BASE_URL`, wildcard CORS, local storage, placeholder secrets, zero proxy trust); startup must fail.
4. Configure Redis and make it unavailable; readiness may report cache degraded while DB-backed behavior remains available because Redis is an optional cache.
5. Make PostgreSQL unavailable after startup; `/health/ready` must return 503 and list/catalog APIs must return server errors rather than fabricated empty success.
6. Send malicious `Host`/forwarded-host headers; catalog artwork, featured artist assets and protected local playback URLs must continue to use validated `APP_BASE_URL`.
7. Verify payment, upload, playback-access, heartbeat and auth abuse limits return stable 429 `RATE_LIMITED` responses during excess traffic without rate-limiting provider webhook ingress.
8. Exercise catalog cursor pagination and admin audit pagination over stable seeded data; verify no duplicate/skip and max page-size enforcement.
9. Send SIGTERM and simulate fatal runtime rejection; listener, PostgreSQL pools and Redis must close through the controlled shutdown path and fatal runtime errors must exit non-zero.

## Evidence status

Until the commands/manual scenarios above are executed and attached to Confluence, Phase 05A remains `IMPLEMENTED — EVIDENCE/GAPS PENDING` rather than `VERIFIED COMPLETE`.
