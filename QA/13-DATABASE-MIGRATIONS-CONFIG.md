# 13 — Database, Migrations, Constraints & Production Configuration

## Scope

Covers canonical SQL-first migration order, fresh/upgrade migration safety, schema readiness, Prisma alignment where used, runtime DDL prohibition, constraints/indexes, production configuration validation and fail-closed behavior when DB/schema/config is invalid.

## Build/migration commands

```bash
cd backend
npm ci
npm run typecheck
npm run build
npm run db:migrate:status
npm run db:migrate
npm run db:schema:check
npm run verify
```

At current hardening baseline, schema readiness must include all migrations through privacy/recovery (`0013`) and preserve earlier distribution (`0011`) and adaptive-media (`0012`) requirements.

## Fresh database test

Use an empty disposable Postgres DB.

1. Confirm no application tables.
2. Run canonical migration command.
3. Record each applied migration.
4. Run schema check/status.
5. Start backend.
6. Exercise health/readiness and representative CRUD/business paths.

Expected: no manual SQL, schema pull or runtime endpoint is required to make the app start.

## Upgrade test

Restore representative earlier database snapshot/data and migrate forward.

Capture before/after counts and key references for:

- users;
- sessions;
- artists/content;
- payments/refunds;
- subscriptions;
- analytics/audit;
- provider/media identity;
- releases/tracks/distribution domain;
- adaptive video fields;
- privacy/deletion queue.

Verify no unexpected deletion/orphaning and that playback/payment ownership remains intact.

## Migration-order/repeatability

- migration status before apply;
- apply once;
- apply/status again;
- application startup twice;
- two instances start concurrently against already-migrated DB.

Expected: no duplicate DDL/object errors and no app-instance race creating schema.

## Runtime DDL prohibition

Search/observe runtime paths for `CREATE TABLE`, `ALTER TABLE`, opportunistic missing-column repair or schema mutation. Then intentionally run application against an unmigrated DB.

Expected: startup/readiness/schema gate fails clearly. The application must not silently create missing business/security columns during normal requests.

## Constraint tests

Attempt direct controlled invalid writes in QA or through APIs where safer:

- duplicate financial/provider unique references;
- duplicate active entitlement where uniqueness is defined;
- invalid enum/state values;
- invalid foreign keys;
- orphan release/track/contributor relation;
- invalid adaptive status/quality labels;
- non-positive dimensions where constrained;
- duplicate media deletion queue semantics;
- audit mutation if DB trigger/immutability protection exists.

Expected: DB/service rejects invalid state even if client validation is bypassed.

## Transaction atomicity

Failure-inject critical multi-table operations:

- payment success + subscription activation;
- refund + entitlement effect;
- content moderation + audit;
- artist approval + audit;
- anonymization + session/playback revocation + deletion queue;
- media upload metadata + provider identity.

Expected: all-or-nothing where transaction contract requires it; no half-applied authoritative state.

## Index/query sanity

Using representative non-trivial QA data, inspect query plans/latency for:

- artist/content discovery;
- active subscription lookup by Fan/Artist;
- payment/provider reference lookup;
- stream authorization content/session lookup;
- analytics aggregation hot paths;
- audit listing/filter;
- media deletion queue claim;
- adaptive readiness selection/backfill.

Do not optimize by guess alone; record obviously sequential/hot queries that become P1/P2 risks at expected scale.

## Prisma/schema alignment

Where Prisma is used for generation/types, run:

```bash
npx prisma generate
npm run typecheck
```

Verify new Phase 09B fields/models required by compiled code exist. Existing known historical Prisma-vs-SQL breadth drift should be documented rather than fixed by `db pull` during QA unless a separate approved change is made. SQL migrations/schema-readiness remain authoritative for runtime DB structure.

## Production config safety matrix

Test production startup with one mutation at a time:

- missing/invalid DB URL;
- HTTP/local app URL;
- wildcard CORS;
- missing/invalid proxy hops;
- missing JWT/signature/media secret;
- placeholder/weak secret;
- local storage selected;
- chosen provider missing credentials;
- invalid provider webhook URL;
- subscription enabled without Razorpay keys/webhook secret;
- invalid TTL/upload limits;
- malformed Redis/Sentry URL.

Expected: invalid mandatory production configuration fails before serving business traffic.

## Database outage behavior

While app is running, make QA DB temporarily unavailable.

Verify:

- readiness becomes unhealthy;
- auth/payment/subscription/access do not fail open;
- admin mutations return safe errors;
- analytics/report failures do not corrupt core state;
- reconnection restores service without runtime DDL or process corruption.

## Replica/cache behavior

If a read replica is configured, prove security/payment/access decisions do not rely on stale replica state where primary authority is required. If Redis is unavailable, DB authority must remain correct and no cached entitlement can override revocation.

## Exit criteria

Fresh and upgrade migrations are repeatable, schema readiness blocks old DBs, runtime DDL/fallback repair is absent, constraints protect critical invariants, configuration fails closed, and DB/cache failures never grant authorization or financial success.
