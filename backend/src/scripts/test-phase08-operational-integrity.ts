import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { calculateHeartbeatAcceptance } from "../shared/security/playback-heartbeat.policy";

const SRC = path.resolve(__dirname, "..");
const ROOT = path.resolve(SRC, "..");
const REPO = path.resolve(ROOT, "..");
const readBackend = (relativePath: string) =>
  fs.readFileSync(path.join(SRC, relativePath), "utf8");
const readRepo = (relativePath: string) =>
  fs.readFileSync(path.join(REPO, relativePath), "utf8");

function testHeartbeatPolicy() {
  const first = calculateHeartbeatAcceptance({
    sequence: 1,
    previousSequence: 0,
    currentPosition: 1,
    lastAcceptedPosition: 0,
    serverElapsedSeconds: null,
  });
  assert.equal(first.acceptedSeconds, 0);
  assert.equal(first.reason, "FIRST_HEARTBEAT");

  const replay = calculateHeartbeatAcceptance({
    sequence: 1,
    previousSequence: 1,
    currentPosition: 30,
    lastAcceptedPosition: 1,
    serverElapsedSeconds: 30,
  });
  assert.equal(replay.duplicateOrReplay, true);
  assert.equal(replay.acceptedSeconds, 0);

  const rapid = calculateHeartbeatAcceptance({
    sequence: 2,
    previousSequence: 1,
    currentPosition: 10,
    lastAcceptedPosition: 1,
    serverElapsedSeconds: 1,
  });
  assert.equal(rapid.acceptedSeconds, 0);
  assert.equal(rapid.reason, "TOO_FREQUENT");

  const backward = calculateHeartbeatAcceptance({
    sequence: 3,
    previousSequence: 2,
    currentPosition: 5,
    lastAcceptedPosition: 10,
    serverElapsedSeconds: 30,
  });
  assert.equal(backward.acceptedSeconds, 0);
  assert.equal(backward.acceptedPosition, 10);

  const hugeJump = calculateHeartbeatAcceptance({
    sequence: 4,
    previousSequence: 3,
    currentPosition: 10_000,
    lastAcceptedPosition: 10,
    serverElapsedSeconds: 30,
  });
  assert.equal(hugeJump.acceptedSeconds, 30);

  const capped = calculateHeartbeatAcceptance({
    sequence: 5,
    previousSequence: 4,
    currentPosition: 100,
    lastAcceptedPosition: 10,
    serverElapsedSeconds: 60,
  });
  assert.equal(capped.acceptedSeconds, 45);

  const late = calculateHeartbeatAcceptance({
    sequence: 6,
    previousSequence: 5,
    currentPosition: 130,
    lastAcceptedPosition: 100,
    serverElapsedSeconds: 120,
  });
  assert.equal(late.acceptedSeconds, 0);
  assert.equal(late.reason, "TOO_LATE");
}

function testSourceContracts() {
  const sessions = readBackend("shared/security/playback-session.service.ts");
  const access = readBackend("modules/media/media-access.service.ts");
  const streamRoutes = readBackend("modules/streaming/stream.routes.ts");
  const analyticsRoutes = readBackend("modules/analytics/analytics.routes.ts");
  const audit = readBackend("shared/audit/audit.service.ts");
  const artistApproval = readBackend("modules/artist/artist-approval.service.ts");
  const artistApprovalRoutes = readBackend("routes/admin/artist-approvals.ts");
  const jobs = readBackend("runtime/operational-job-claim.ts");
  const schedulers = readBackend("runtime/subscription-schedulers.ts");
  const schema = readBackend("common/db/schema-readiness.ts");
  const migration = readRepo(
    "backend/db/migrations/20260913_0010_analytics_audit_operational_integrity.sql"
  );
  const mobileHeartbeat = readRepo(
    "mobile/apps/fan/src/services/heartbeatService.ts"
  );
  const adminAnalytics = readBackend("controllers/adminAnalyticsController.ts");
  const adminAnalyticsRoutes = readBackend("routes/admin/analytics.ts");

  assert.match(sessions, /FOR UPDATE/);
  assert.match(sessions, /last_heartbeat_sequence/);
  assert.match(sessions, /trusted_listened_seconds/);
  assert.match(sessions, /INSERT INTO user_listening_stats/);
  assert.match(sessions, /ON CONFLICT \(playback_session_id\)/);
  assert.match(sessions, /session:\$\{sessionId\}:PLAY_STARTED/);

  assert.doesNotMatch(access, /recordPlaybackStarted/);
  assert.match(access, /trusted heartbeat path/);

  assert.match(streamRoutes, /heartbeatEntitlementAllowed/);
  assert.match(streamRoutes, /positiveInteger\(req\.body\?\.sequence\)/);
  assert.match(streamRoutes, /PLAYBACK_SESSION_REVOKED/);

  assert.match(mobileHeartbeat, /const sequence = \+\+heartbeatSequence/);
  assert.match(mobileHeartbeat, /\n\s*sequence,\n\s*currentPosition:/);

  assert.match(analyticsRoutes, /ON CONFLICT \(user_id, event_key\) DO NOTHING/);
  assert.match(analyticsRoutes, /isPlaybackSessionActive/);
  assert.match(analyticsRoutes, /CONTENT_VIEW_DEDUPE_WINDOW_MS/);
  assert.doesNotMatch(analyticsRoutes, /payments|transactions|earnings/i);

  assert.match(audit, /static async logCritical/);
  assert.match(audit, /SENSITIVE_KEY/);
  assert.match(audit, /\[REDACTED\]/);
  assert.match(artistApproval, /AuditService\.logCritical\([\s\S]*?client\s*\)/);
  assert.match(artistApproval, /await client\.query\("COMMIT"\)/);
  assert.doesNotMatch(artistApprovalRoutes, /AuditService\.log\(/);
  assert.doesNotMatch(artistApprovalRoutes, /const safeQuery/);

  assert.match(jobs, /run_token/);
  assert.match(jobs, /ON CONFLICT \(job_name, window_key\)/);
  assert.match(jobs, /operational_job_runs\.status = 'FAILED'/);
  assert.match(schedulers, /runClaimedJob/);
  assert.match(schedulers, /stale-playback-session-cleanup/);

  assert.match(schema, /20260913_0010_analytics_audit_operational_integrity/);
  assert.match(schema, /"run_token"/);
  assert.match(schema, /audit_logs_append_only/);
  assert.match(migration, /CREATE TRIGGER audit_logs_append_only/);
  assert.match(migration, /analytics_events_user_event_key_unique/);
  assert.match(migration, /idx_content_plays_playback_session_unique/);

  assert.doesNotMatch(adminAnalytics, /Math\.max\(paymentsRevenue, transactionsRevenue\)/);
  assert.doesNotMatch(adminAnalytics, /ANALYTICS-DEBUG|_debug/);
  assert.match(adminAnalytics, /FROM payments/);
  assert.doesNotMatch(adminAnalyticsRoutes, /Math\.max\(|transactionsRevenue|transactionRows/);
  assert.doesNotMatch(adminAnalyticsRoutes, /_debug/);
  assert.match(adminAnalyticsRoutes, /FROM payments/);
}

function run() {
  testHeartbeatPolicy();
  testSourceContracts();
  console.log("Phase 08 operational integrity checks passed.");
}

run();
