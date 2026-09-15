# Phase 09B — Data Lifecycle, Retention & Recovery Runbook

Status: implementation support document. Retention durations that require business/legal approval remain **DECISION REQUIRED** and are not invented here.

## 1. Data inventory

| Category | Authoritative store | Sensitivity | Active-product purpose | Deletion/anonymization behavior | Backup | Access |
| --- | --- | --- | --- | --- | --- | --- |
| Identity/profile | `users` | High | authentication/profile/artist identity | stable row retained; ordinary profile PII may be anonymized by explicit privacy operation; agreement/signature fields remain pending legal policy | Yes | subject + authorized admin paths |
| Password hash | `users.password` | High | authentication | replaced with random unknown bcrypt hash during anonymization | Yes | auth service only |
| Device sessions | `user_sessions` | High | active server session/device state | deleted immediately on anonymization; retention cleanup accepts explicit approved cutoff only | Yes, but not restored as proof of active authorization without app validation | subject/auth service |
| Password-reset / verification tokens | No canonical persisted store found in Phase-1 schema/code | High if introduced | not currently persisted as a Phase-1 recovery-token domain | no cleanup table exists because no authoritative persisted token store was found; any future store must be added to the privacy lifecycle | N/A today | auth service if introduced |
| Push notification tokens | No canonical persisted store found in Phase-1 schema/code | High if introduced | notifications | no cleanup table exists because no authoritative push-token store was found; any future store must be deleted/revoked during anonymization | N/A today | notification service if introduced |
| Playback sessions | `playback_sessions` | Medium/High | secure playback lease + trusted listening state | active leases ended on anonymization; ended rows can be pruned only with explicit cutoff | Yes | server analytics/playback services |
| Profile media | `user_media_assets` + storage provider | Medium | avatar/profile presentation | provider deletion queued before local profile-asset reference is removed | DB metadata yes; provider asset recovered according to provider capability | subject/admin via guarded asset flows |
| Artist/content ownership | `users`, `content_items`, release tables | High/business | ownership/moderation/distribution-ready lineage | user row is not hard-deleted; ownership remains stable; account anonymization makes artist inaccessible through account governance; physical media deletion is separate | Yes | artist/admin/server |
| Content masters/artwork | `content_items` + provider | High/business | playback/content delivery | takedown does not imply physical deletion; approved physical deletion must use reconciliation queue | DB metadata yes; media backup/recovery depends on provider | admin/provider boundary |
| Subscriptions | `subscriptions` | Financial | fixed-term entitlement/billing history | rows and captured status are preserved on anonymization; access is revoked by account/session/playback governance rather than fabricating a cancellation state | Yes | subject/admin/payment services |
| Transactions/payments/refunds | `transactions`, `payments`, `refund_requests` | Financial/high | accounting/reconciliation/refunds | preserved; never cascade-deleted by privacy operation | Yes | subject-limited/admin/finance/server |
| Invoices | No canonical Phase-1 invoice table/feature found | Financial if introduced | not currently implemented as a separate authoritative domain | no invoice deletion rule is fabricated; if invoice persistence is later added it must inherit financial-retention protections | N/A today | finance/admin if introduced |
| Gateway references | payment/refund tables | Financial/high | reconciliation | preserved according to accounting/legal policy | Yes | finance/payment services |
| Audit | `audit_logs`, `subscription_audit_logs` | High/security | forensic/business evidence | append-only audit remains; retention duration/pseudonymization policy is DECISION REQUIRED | Yes | authorized admin/security |
| Raw analytics | `analytics_events`, `content_plays`, playback rows | Medium/high | product/listening analytics | cleanup supported only via explicit cutoff; financial rows never coupled to analytics cleanup | Yes until approved prune | server/admin analytics |
| Aggregated listening data | `user_listening_stats`, artist/platform aggregates | Medium | dashboard/aggregate metrics | retention/anonymization policy is DECISION REQUIRED | Yes | subject/artist/admin as scoped |
| Distribution-ready metadata | release/distribution tables | Business/high | future Phase-2 compatibility | preserved with stable artist/content identity; privacy handling must not fabricate distributor state | Yes | artist/admin/server |
| Application logs/Sentry | external/runtime | Potentially high | observability | secrets/tokens/signed URLs prohibited by logging contract; provider retention is DECISION REQUIRED | Provider-specific | operations only |

The Deal Agreement establishes that user information, subscription/payment data, artist metadata and audio/video content remain client/respective-artist data. This lifecycle therefore minimizes or anonymizes ordinary profile data without erasing the accounting, audit, ownership and content-history anchors required by the approved architecture.

## 2. Account lifecycle

The platform has two intentionally separate operations:

1. **Reversible account state** — suspend/ban/admin soft-delete/reactivate. Existing business flows may restore access.
2. **Irreversible privacy anonymization** — explicit `anonymizeAccount` capability. It:
   - keeps `users.id` as the stable referential anchor;
   - invalidates authentication by replacing email/password credentials;
   - marks the account inactive/deleted/anonymized;
   - removes ordinary profile PII;
   - removes local profile-media references after queueing provider deletion;
   - deletes server sessions;
   - ends active playback sessions;
   - preserves fixed-term subscription rows and their historical state;
   - preserves payment/refund/audit/content/release relationships;
   - does **not** automatically erase agreement/signature data without an approved legal rule.

Phase-1 artist subscriptions are fixed-term and non-recurring. Anonymization therefore does not invent a `CANCELLED` billing state. The subject cannot authenticate after anonymization, active server sessions are removed, playback leases are ended, and artist content is excluded by account-governance checks when the artist account is inactive/deleted.

Repeated anonymization is idempotent.

## 3. Retention cleanup

`npm run cleanup:retention -- --sessions-before=<ISO> --playback-before=<ISO> --analytics-before=<ISO>`

Every argument is optional individually, but at least one is required. There is deliberately no default duration. The caller must use an approved policy cutoff.

The cleanup job:

- uses a PostgreSQL advisory lock to prevent concurrent cleanup workers;
- records the exact cutoff set in `operational_job_runs`;
- reruns failed windows safely;
- skips already completed windows;
- removes only stale `user_sessions`, ended `playback_sessions`, and raw `analytics_events` selected by the supplied cutoffs;
- writes a durable audit summary;
- does not touch subscriptions, payments, refunds, audit evidence, content ownership, or provider media.

Raw-event cleanup and aggregate-data retention are intentionally separate. The current implementation provides an explicit raw `analytics_events` cutoff but does not guess a lifecycle for `user_listening_stats` or other aggregates; that remains a policy decision.

## 4. Physical media deletion

Physical provider deletion is separate from takedown/unpublish.

Content deletion is a two-step safety model:

1. the content must already be taken down by the normal moderation/business lifecycle;
2. an explicit destructive request (`privacy:queue-content-deletion`) queues its mapped master/artwork assets for provider deletion.

`content_items.physical_deletion_status` distinguishes `NOT_REQUESTED`, `PENDING`, `FAILED`, and `COMPLETED`. Takedown itself never changes this state or queues provider deletion.

`media_deletion_requests` stores the original provider + key/asset identity. `npm run cleanup:media-deletions` claims rows with `FOR UPDATE SKIP LOCKED`, calls the recorded provider, and marks a row complete only after provider deletion returns success. Failures remain `FAILED` with bounded exponential retry scheduling. Content becomes physically `COMPLETED` only when all queued assets for that content are provider-confirmed deleted.

This avoids false-success responses and remains safe if the configured default storage provider changes later. Because content must already be taken down before physical deletion can be queued, playback is already denied by the Phase-02 governance boundary while deletion is pending or retrying.

## 5. Production backup configuration — observed 2026-09-14

The connected production database project is the Neon project `music-streaming`, default branch `production`.

Observed read-only configuration on 2026-09-14:

- project history retention: **21,600 seconds (6 hours)**;
- explicit snapshot schedule: **none configured**;
- existing explicit snapshots: **none**;
- production branch state: ready;
- production branch is not currently marked protected in Neon.

This is evidence of the current infrastructure state, **not** a claim that six hours satisfies an RPO/backup-retention requirement. No approved music-streaming RPO, backup frequency or backup-retention target was found in the authoritative requirements reviewed for this phase. Therefore:

- no snapshot schedule or retention value is changed automatically by this phase;
- backup frequency/retention remains **DECISION REQUIRED**;
- whether Neon history retention alone is acceptable must be approved by the product/operations owner;
- explicit snapshots should not be configured with an arbitrary retention period merely to make the checklist appear complete;
- Phase 10 must execute a real restore and measure the recovered-data point and elapsed recovery time.

Application code must never write production database backups into the repository or public application filesystem.

The production owner still needs to record/approve:

- accepted recovery mechanism: Neon history/PITR, scheduled snapshots, logical backups, or an approved combination;
- backup/snapshot frequency;
- retention duration;
- encryption/access control and restore-authorized operators;
- backup success/failure monitoring;
- whether provider media is independently versioned/backed up;
- whether the production Neon branch should be protected as an operational safeguard.

A portable logical backup can be used for an isolated restore drill where appropriate:

```bash
pg_dump --format=custom --no-owner --no-acl "$SOURCE_DATABASE_URL" > /secure/operator/path/music-streaming.dump
```

Do **not** place that dump under the source checkout.

## 6. Restore runbook

1. Provision a new isolated non-production PostgreSQL target.
2. Restrict credentials to the restore operator and test application only.
3. Restore the selected Neon history point/snapshot, or for a logical drill:

```bash
pg_restore --no-owner --no-acl --clean --if-exists --dbname "$RESTORE_DATABASE_URL" /secure/operator/path/music-streaming.dump
```

4. Point only a non-production backend at the restored DB.
5. Run:

```bash
DATABASE_URL="$RESTORE_DATABASE_URL" npm run db:migrate:status
DATABASE_URL="$RESTORE_DATABASE_URL" npm run db:schema:check
```

6. If the backup predates the application schema, apply only the repository migrations that are newer than the restored schema and are approved for that target.
7. Validate representative relationships without modifying production:
   - fan + server session state;
   - artist + content/release ownership;
   - subscription + transaction + payment/refund linkage;
   - audit append-only trigger;
   - playback/analytics referential integrity;
   - media-provider identity references.
8. Record start/end timestamps, latest recovered business timestamp, source backup/snapshot/history-point identifier and application commit.
9. Destroy or securely retain the isolated restore environment according to the approved operational policy.

## 7. RPO/RTO

No RPO/RTO value is asserted by this document. Phase 10 must measure the restore drill and compare it only with an approved contractual/product target. If the hosting/provider configuration cannot meet the approved target, record the gap explicitly rather than hiding it.

## 8. Data export / subject access

No Phase-1 user-data export/access feature was found in the reviewed PRD/Deal/HLD/DLD scope for this hardening phase. Phase 09B therefore does **not** invent a new export product feature. If a later legal/business requirement adds subject export/access, it must be ownership-scoped, exclude secrets/internal security metadata, and use expiring delivery if downloadable files are generated.

## 9. Logs and error monitoring

Phase-08 audit/logging safeguards remain authoritative. Source audit for this phase did not find direct `logger` request-body or playback-URL logging patterns in the searched code paths. Audit metadata passes through the canonical redaction boundary. Operational log/Sentry retention duration is still **DECISION REQUIRED** and must be aligned with the monitoring provider before delivery.

No code in Phase 09B adds password/token/webhook-secret/signed-media-URL logging.

## 10. Explicit unresolved policy / operational decisions

The following remain **DECISION REQUIRED** unless a higher-priority approved source supplies them:

- ordinary profile/account hard-purge timing, if any;
- financial/payment/refund retention duration;
- audit retention and post-anonymization actor-identification policy;
- raw analytics retention duration;
- aggregate analytics retention/anonymization rules;
- agreement/signature/IP/user-agent retention after account anonymization;
- application log and Sentry retention;
- accepted production backup mechanism beyond the currently observed six-hour Neon history window;
- snapshot/backup frequency and retention;
- whether the Neon production branch should be protected;
- provider-media backup/versioning retention;
- any legal hold workflow.

The implementation therefore supplies safe mechanisms without fabricating those policy values.
