import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const BACKEND = path.resolve(SRC, "..");
const REPO = path.resolve(BACKEND, "..");

const readBackend = (relativePath: string) =>
  fs.readFileSync(path.join(SRC, relativePath), "utf8");
const readRepo = (relativePath: string) =>
  fs.readFileSync(path.join(REPO, relativePath), "utf8");

function testMigrationContract() {
  const migration = readRepo(
    "backend/db/migrations/20260914_0013_privacy_retention_recovery.sql"
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS anonymized_at/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS anonymization_reason/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS physical_deletion_status/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS physical_deletion_requested_at/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS physical_deleted_at/);
  assert.match(migration, /content_items_physical_deletion_status_valid/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS media_deletion_requests/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /media_deletion_requests_entity_type_valid/);
  assert.match(migration, /media_deletion_requests_status_valid/);
  assert.match(migration, /media_deletion_requests_provider_valid/);
  assert.match(migration, /idx_media_deletion_requests_pending/);
  assert.match(migration, /idx_content_items_physical_deletion/);
  assert.match(migration, /idx_user_sessions_retention_cleanup/);
  assert.match(migration, /idx_playback_sessions_retention_cleanup/);
  assert.match(migration, /idx_analytics_events_retention_cleanup/);
  assert.doesNotMatch(
    migration,
    /INTERVAL\s+'(?:30|60|90|180|365)\s+days'/i,
    "Phase 09B migration must not invent legal retention durations"
  );
}

function testAccountAnonymizationContract() {
  const service = readBackend("modules/privacy/account-privacy.service.ts");

  assert.match(service, /FOR UPDATE/);
  assert.match(service, /anonymized_at/);
  assert.match(service, /anonymized\+\$\{userId\}@privacy\.invalid/);
  assert.match(service, /bcrypt\.hash/);
  assert.match(service, /DELETE FROM user_media_assets WHERE user_id = \$1/);
  assert.match(service, /DELETE FROM user_sessions WHERE user_id = \$1/);
  assert.match(service, /UPDATE playback_sessions/);
  assert.match(service, /ended_at = COALESCE\(ended_at, now\(\)\)/);
  assert.match(service, /SELECT COUNT\(\*\)::int AS count[\s\S]*FROM subscriptions/);
  assert.match(service, /subscriptionRowsPreserved/);
  assert.match(service, /subscriptionHistoryPreserved: true/);
  assert.match(service, /privacy\.account_anonymized/);
  assert.match(service, /financialHistoryPreserved: true/);
  assert.match(service, /auditHistoryPreserved: true/);
  assert.match(service, /contentOwnershipPreserved: true/);

  assert.doesNotMatch(service, /UPDATE subscriptions/i);
  assert.doesNotMatch(service, /status\s*=\s*'CANCELLED'/i);
  assert.doesNotMatch(service, /DELETE FROM users/i);
  assert.doesNotMatch(service, /DELETE FROM transactions/i);
  assert.doesNotMatch(service, /DELETE FROM payments/i);
  assert.doesNotMatch(service, /DELETE FROM refund_requests/i);
  assert.doesNotMatch(service, /DELETE FROM audit_logs/i);
  assert.doesNotMatch(service, /DELETE FROM content_items/i);
}

function testProviderDeletionContract() {
  const service = readBackend("modules/privacy/media-deletion.service.ts");

  assert.match(service, /queueContentPhysicalDeletion/);
  assert.match(service, /is_taken_down/);
  assert.match(service, /CONTENT_TAKEDOWN_REQUIRED/);
  assert.match(service, /physical_deletion_status = 'PENDING'/);
  assert.match(service, /physical_deletion_status = 'FAILED'/);
  assert.match(service, /physical_deletion_status = 'COMPLETED'/);
  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /getStorageProviderByName\(row\.storage_provider\)/);
  assert.match(service, /await provider\.delete\(row\.storage_key/);
  assert.match(service, /status = 'COMPLETED'/);
  assert.match(service, /status = 'FAILED'/);
  assert.match(service, /next_attempt_at/);
  assert.match(service, /retryDelaySeconds/);
  assert.match(service, /privacy\.content_physical_deletion_requested/);
  assert.match(service, /privacy\.media_deleted/);

  const deleteCall = service.indexOf("await provider.delete");
  const completeCall = service.indexOf("await markCompleted", deleteCall);
  assert.ok(deleteCall >= 0 && completeCall > deleteCall, "provider confirmation must precede COMPLETED state");

  const governance = readBackend("modules/content/content-governance.service.ts");
  assert.doesNotMatch(
    governance,
    /queueContentPhysicalDeletion|media_deletion_requests/,
    "Business takedown must not silently trigger physical deletion"
  );
}

function testGuardedDestructiveCommands() {
  const anonymize = readBackend("scripts/anonymize-account.ts");
  const contentDelete = readBackend("scripts/queue-content-deletion.ts");

  assert.match(anonymize, /ANONYMIZE-\$\{userId\}/);
  assert.match(contentDelete, /DELETE-CONTENT-\$\{contentId\}/);
  assert.match(contentDelete, /queueContentPhysicalDeletion/);
}

function testRetentionCleanupContract() {
  const cleanup = readBackend("scripts/cleanup-retained-data.ts");

  assert.match(cleanup, /No cleanup cutoff supplied/);
  assert.match(cleanup, /--sessions-before/);
  assert.match(cleanup, /--playback-before/);
  assert.match(cleanup, /--analytics-before/);
  assert.match(cleanup, /pg_try_advisory_lock/);
  assert.match(cleanup, /operational_job_runs/);
  assert.match(cleanup, /DELETE FROM user_sessions/);
  assert.match(cleanup, /DELETE FROM playback_sessions/);
  assert.match(cleanup, /ended_at IS NOT NULL/);
  assert.match(cleanup, /DELETE FROM analytics_events/);
  assert.match(cleanup, /privacy\.retention_cleanup_completed/);

  assert.doesNotMatch(cleanup, /DELETE FROM transactions/i);
  assert.doesNotMatch(cleanup, /DELETE FROM payments/i);
  assert.doesNotMatch(cleanup, /DELETE FROM refund_requests/i);
  assert.doesNotMatch(cleanup, /DELETE FROM audit_logs/i);
  assert.doesNotMatch(cleanup, /(?:30|60|90|180|365)\s*\*\s*24\s*\*\s*60\s*\*\s*60/);
}

function testSchemaReadinessContract() {
  const readiness = readBackend("common/db/schema-readiness.ts");
  assert.match(readiness, /20260914_0013_privacy_retention_recovery/);
  assert.match(readiness, /media_deletion_requests/);
  assert.match(readiness, /physical_deletion_status/);
  assert.match(readiness, /anonymized_at/);
  assert.match(readiness, /idx_media_deletion_requests_pending/);
  assert.match(readiness, /content_items_physical_deletion_status_valid/);
}

function testRunbookContract() {
  const runbook = readRepo("backend/PHASE_09B_DATA_LIFECYCLE_RECOVERY.md");
  assert.match(runbook, /DECISION REQUIRED/);
  assert.match(runbook, /stable row retained/i);
  assert.match(runbook, /fixed-term subscription rows/i);
  assert.match(runbook, /does not invent a `CANCELLED` billing state/i);
  assert.match(runbook, /financial/i);
  assert.match(runbook, /audit/i);
  assert.match(runbook, /pg_dump/);
  assert.match(runbook, /pg_restore/);
  assert.match(runbook, /isolated non-production/i);
  assert.match(runbook, /RPO\/RTO/);
  assert.doesNotMatch(runbook, /RPO:\s*[≤<]/i);
  assert.doesNotMatch(runbook, /RTO:\s*[≤<]/i);
}

function testReversibleSoftDeleteRemainsSeparate() {
  const accountState = readBackend("common/auth/account-state.service.ts");
  assert.match(accountState, /softDelete/);
  assert.match(accountState, /reactivate/);
  assert.doesNotMatch(accountState, /anonymized_at/);
}

function run() {
  testMigrationContract();
  testAccountAnonymizationContract();
  testProviderDeletionContract();
  testGuardedDestructiveCommands();
  testRetentionCleanupContract();
  testSchemaReadinessContract();
  testRunbookContract();
  testReversibleSoftDeleteRemainsSeparate();
  console.log("Phase 09B privacy/retention/recovery contract checks passed.");
}

run();
