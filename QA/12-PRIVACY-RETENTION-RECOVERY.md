# 12 — Privacy, Retention, Media Deletion, Backup & Recovery

## Scope

Covers irreversible account anonymization, preservation of financial/audit/content lineage, session/playback revocation, provider-asset deletion queue and retries, policy-driven retention cleanup, backup configuration review and isolated restore testing.

## Important policy rule

Do **not** invent retention durations. Where product/legal policy has not approved a duration, QA records the decision as unresolved and tests only that cleanup requires an explicit cutoff/policy input.

## Automated/source gate

```bash
cd backend
npm run test:phase09b-privacy-recovery
npm run verify
```

Destructive scripts must run only against isolated QA data:

```bash
npm run privacy:anonymize-account -- <approved arguments>
npm run privacy:queue-content-deletion -- <approved arguments>
npm run cleanup:media-deletions
npm run cleanup:retention -- <explicit approved cutoff arguments>
```

Use the exact CLI help/current source contract. Never copy production IDs into test commands.

## Account anonymization positive case

Create a QA user with:

- profile PII;
- active server session;
- playback session;
- payment/subscription history;
- audit history;
- profile media asset;
- optional content/artist relationships as applicable.

Execute the guarded anonymization command using its exact confirmation mechanism.

Expected:

- stable `users.id` remains for historical FK integrity;
- ordinary profile PII is anonymized/removed per implementation;
- active server sessions revoked;
- active playback sessions ended;
- future authentication denied;
- profile-media physical deletion is queued;
- payment/subscription/audit history remains structurally intact;
- content/financial lineage does not break;
- legal/agreement/signature fields are preserved unless an approved legal policy says otherwise.

## Destructive-operation safety

| ID | Test | Expected |
|---|---|---|
| PRIV-NEG-001 | wrong/missing confirmation string | no mutation |
| PRIV-NEG-002 | nonexistent user | safe no-op/error, no other user affected |
| PRIV-NEG-003 | malformed user ID | rejected |
| PRIV-NEG-004 | execute twice | second run idempotent/safe |
| PRIV-NEG-005 | DB failure mid-transaction | no partially anonymized account where transaction can protect it |
| PRIV-NEG-006 | concurrent login/request while anonymization executes | access converges to denied; no privilege survives |

## Financial/history preservation

Before and after anonymization compare:

- captured payments;
- refunds;
- subscription history;
- audit rows;
- content ownership/release references;
- aggregate financial/report relationships.

IDs/relationships needed for legal/financial traceability must remain valid, while public/profile PII is no longer exposed.

## Provider asset deletion queue

Test with profile media and content media separately where supported:

1. request deletion only after allowed lifecycle/takedown precondition;
2. confirm queue row stores original provider identity;
3. process queue;
4. provider confirms deletion;
5. local deletion lifecycle becomes completed only after provider success.

Negative/edge cases:

- provider unavailable;
- provider returns failure;
- wrong active runtime provider vs asset's recorded provider;
- duplicate queue request;
- concurrent workers process queue;
- process crash after claim;
- provider says object already missing;
- malformed provider asset identity;
- DB failure after provider deletion.

Expected: `FOR UPDATE SKIP LOCKED`/claiming or equivalent prevents duplicate worker execution; failures retry/back off; wrong provider is never used because runtime config changed.

## Takedown vs physical deletion

Prove these are distinct:

- takedown immediately removes playback eligibility but does not falsely claim binary is physically deleted;
- deletion request enters pending state;
- failed provider deletion shows failed/retryable state;
- only confirmed provider deletion becomes deleted/completed;
- audit/operational evidence remains.

## Retention cleanup

Run against QA rows older/newer than an explicitly supplied cutoff.

Test independently where implemented:

- stale server sessions;
- ended playback sessions;
- raw analytics events.

Expected:

- no hidden default retention period;
- rows newer than cutoff remain;
- financial/audit history is untouched;
- advisory lock/idempotent job-run record prevents unsafe concurrent cleanup;
- rerun produces stable result.

Negative:

- missing cutoff/policy input;
- future cutoff that would delete active/recent data;
- malformed timestamp;
- concurrent cleanup processes;
- DB interruption mid-cleanup.

## Backup configuration evidence

Record actual staging/production-intended database backup mechanism:

- provider/project;
- history/PITR retention;
- snapshot schedule;
- manual snapshot availability;
- encryption/access policy where available;
- current RPO/RTO target from HLD (RPO 15 min, RTO 4 h) versus actual configured capability.

Do not mark RPO/RTO passed merely because provider history exists.

## Restore drill

Mandatory before final GO:

1. create backup/snapshot at known timestamp;
2. make a controlled post-backup QA change;
3. restore into isolated database/project/branch;
4. run migration status/schema check;
5. start backend against restored DB;
6. verify representative Fan, Artist, Admin, content, payment, subscription, audit and distribution relationships;
7. verify protected playback metadata references remain coherent;
8. measure total restore time;
9. determine latest recovered data point and measured data loss window;
10. destroy/isolate restored environment after evidence retention.

Never point production clients at the restore-test DB.

## Privacy exposure checks

After anonymization search:

- Fan/public endpoints;
- Artist/Admin lists where PII should no longer display;
- logs/Sentry;
- analytics events;
- profile media URL;
- caches.

Ensure removed PII is not still reachable from normal application paths. Document fields intentionally retained for legal/financial reasons.

## Exit criteria

Account anonymization revokes access while preserving required history, media deletion is provider-confirmed and retryable, retention cleanup is explicit-policy only and concurrency-safe, and a real isolated backup restore drill demonstrates recoverability with measured time/recovery point.
