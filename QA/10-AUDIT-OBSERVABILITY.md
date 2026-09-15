# 10 — Audit Logging, Observability & Error Traceability

## Scope

Covers immutable audit logs, mandatory sensitive-action events, structured request logging, correlation IDs, error taxonomy, Sentry/error capture, secret redaction, operational health/readiness and traceability across external callbacks.

## Core rules

- Sensitive governance/financial actions must produce durable audit records.
- Audit rows are append-only/immutable.
- Errors must be traceable by correlation ID.
- Production responses/logs must not expose secrets, signed URLs, stack traces or sensitive payloads.
- Health/readiness must be useful without leaking internal credentials/details.

## Automated gates

```bash
cd backend
npm run test:phase08-operational
npm run test:runtime-api-contract
npm run test:phase10-final-hardening
npm run verify
```

## Mandatory audit event coverage

Execute and verify audit records for at least:

- artist approval/rejection/verification;
- content approval/rejection/takedown;
- artist/profile governance changes where designated sensitive;
- pricing changes;
- refund initiation/completion/failure where required;
- payment activation-sensitive transitions;
- account suspension/reactivation/deletion/anonymization;
- privacy/media deletion lifecycle actions;
- distribution-domain submissions/status actions if exercised administratively.

For every row verify actor ID/role, action, target/entity, status/outcome, timestamp, correlation ID where available, and only safe metadata.

## Audit immutability

Attempt through supported DB role/application path:

- UPDATE existing audit row;
- DELETE audit row;
- overwrite via application endpoint;
- duplicate event insertion during action retry.

Expected: application exposes no edit/delete route and DB hardening prevents or detects mutation according to current append-only design. Duplicate business retries must not create misleading contradictory audit history.

## Failure-path audit

For sensitive actions deliberately trigger:

- validation failure;
- wrong role;
- provider failure;
- DB transaction failure where controllable;
- duplicate/idempotent request.

Verify the approved design records required failure/security events without logging secret request data. A failure audit must not falsely state successful business mutation.

## Correlation ID tests

- request with no correlation ID → server creates one;
- request with a valid client correlation ID → traceable end-to-end according to current policy;
- excessively long/malicious correlation ID → normalized/rejected safely, cannot inject log lines;
- provider webhook → internal logs/audit trace with generated/request context;
- 500 error → client receives safe correlation ID usable in logs/Sentry.

## Structured log field checks

Sample successful and failed requests for Fan, Artist and Admin. Verify logs provide enough support context such as:

- correlation ID;
- method/path without sensitive query string;
- status;
- latency;
- safe user/role identifiers where current logger includes them.

Do not require a field not implemented unless authoritative docs require it; record gaps instead.

## Secret/redaction matrix

Trigger flows containing each sensitive value, then search app logs/Sentry for it:

- JWT/access token;
- Authorization header;
- session/device secret;
- password/password hash;
- `JWT_SECRET`;
- `SIGNATURE_ENCRYPTION_KEY`;
- `MEDIA_SIGNED_TOKEN_SECRET`;
- Razorpay key secret/webhook secret;
- Cloudinary API secret;
- Firebase/AWS credentials;
- signed media URL query/token;
- digital signature value;
- unnecessary raw payment/provider webhook data.

Any secret match in production logs/Sentry is P0/P1 depending on exposure.

## Sentry/error tracing

In a production-like QA release:

1. trigger one controlled server 500;
2. verify event appears in configured error tracker;
3. verify correlation ID and safe route metadata allow lookup;
4. verify stack/source mapping is readable where release artifacts support it;
5. verify secrets/query tokens are redacted;
6. trigger controlled Admin Web, Artist Web and Mobile errors where practical and verify symbolication/source maps.

Record release/build identifier.

## Error-response taxonomy

Test:

- unauthenticated → 401;
- wrong role → 403;
- invalid input → 400/validation code;
- missing resource → 404;
- business denial (e.g. entitlement) → documented 4xx;
- DB/provider internal failure → safe 5xx;
- unknown route → standardized 404.

Production 5xx must not expose raw stack, SQL, provider credentials or filesystem path.

## Health/readiness

Validate:

- `/health` and `/health/live` indicate process liveness only;
- `/health/ready` returns 200 when DB ready;
- DB unavailable → readiness 503;
- optional Redis degraded → behavior matches design without incorrectly declaring DB-backed serving healthy/unhealthy;
- health endpoints do not reveal connection strings, secrets, host credentials or full exception details.

## Operational volume/abuse

- burst 4xx errors;
- burst playback denials;
- webhook retries;
- repeated duplicate admin request;
- analytics abuse test.

Confirm logging is useful but does not explode with giant raw payloads or leak tokens. Rate/volume controls should keep service responsive.

## Exit criteria

Required sensitive actions are auditable, audit history is immutable, errors are traceable through correlation IDs and Sentry/logging, health/readiness reflects real serving state, and secrets/private media tokens never appear in production observability outputs.
