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

function testPlaybackAndAnalyticsContracts() {
  const sessions = readBackend("shared/security/playback-session.service.ts");
  const access = readBackend("modules/media/media-access.service.ts");
  const streamRoutes = readBackend("modules/streaming/stream.routes.ts");
  const analyticsRoutes = readBackend("modules/analytics/analytics.routes.ts");
  const artistAnalytics = readBackend("modules/artist/artist-analytics.routes.ts");
  const libraryRoutes = readBackend("modules/library/library.routes.ts");
  const app = readBackend("app.ts");
  const mobileHeartbeat = readRepo("mobile/apps/fan/src/services/heartbeatService.ts");
  const mobileApp = readRepo("mobile/App.tsx");

  assert.match(sessions, /FOR UPDATE/);
  assert.match(sessions, /last_heartbeat_sequence/);
  assert.match(sessions, /trusted_listened_seconds/);
  assert.match(sessions, /INSERT INTO user_listening_stats/);
  assert.match(sessions, /ON CONFLICT \(playback_session_id\)/);
  assert.match(sessions, /session:\$\{sessionId\}:PLAY_STARTED/);
  assert.match(sessions, /INSERT INTO analytics_events/);

  assert.doesNotMatch(access, /recordPlaybackStarted/);
  assert.match(access, /trusted heartbeat path/);

  assert.match(streamRoutes, /heartbeatEntitlementAllowed/);
  assert.match(streamRoutes, /positiveInteger\(req\.body\?\.sequence\)/);
  assert.match(streamRoutes, /PLAYBACK_SESSION_REVOKED/);

  // Sequence is scoped to the server playback session, not to the local timer.
  // Pause/resume keeps the lease alive and therefore must not replay 1..N.
  assert.match(mobileHeartbeat, /let heartbeatSessionId: number \| null = null/);
  assert.match(mobileHeartbeat, /function nextHeartbeatSequence/);
  assert.match(mobileHeartbeat, /if \(heartbeatSessionId !== sessionId\)/);
  assert.match(mobileHeartbeat, /heartbeatInterval && currentContentId === contentId/);
  assert.match(mobileHeartbeat, /const sequence = nextHeartbeatSequence\(lease\.sessionId\)/);
  assert.match(mobileHeartbeat, /\n\s*sequence,\n\s*currentPosition:/);
  const stopStart = mobileHeartbeat.indexOf("export function stopHeartbeat");
  const stopEnd = mobileHeartbeat.indexOf("/** Check if heartbeat", stopStart);
  assert.ok(stopStart >= 0 && stopEnd > stopStart);
  const stopHeartbeatSource = mobileHeartbeat.slice(stopStart, stopEnd);
  assert.doesNotMatch(stopHeartbeatSource, /heartbeatSequence\s*=\s*0/);
  assert.doesNotMatch(stopHeartbeatSource, /heartbeatSessionId\s*=\s*null/);

  // Heartbeat lifecycle is independent of UX playback-history de-duplication.
  assert.match(mobileApp, /function PlaybackHeartbeatLifecycleBridge\(\)/);
  assert.match(mobileApp, /!contentKey \|\| !state\.isPlaying/);
  assert.match(mobileApp, /startHeartbeat\([\s\S]*?positionRef\.current[\s\S]*?durationRef\.current/);
  assert.match(mobileApp, /<PlaybackHeartbeatLifecycleBridge \/>/);

  // Library/history reads must not mutate schema or disclose reusable media URLs.
  assert.doesNotMatch(libraryRoutes, /CREATE TABLE|ALTER TABLE|CREATE INDEX/i);
  assert.doesNotMatch(libraryRoutes, /c\.media_url/);
  assert.match(libraryRoutes, /mediaUrl:\s*null/);
  assert.match(libraryRoutes, /useStreamAccess:\s*true/);

  // Client telemetry can create only deduplicated content views. Trusted plays
  // are server-generated by the heartbeat transaction and survive session cleanup.
  assert.match(analyticsRoutes, /CLIENT_EVENT_TYPES = new Set\(\["CONTENT_VIEWED"\]\)/);
  assert.match(analyticsRoutes, /ON CONFLICT \(user_id, event_key\) DO NOTHING/);
  assert.match(analyticsRoutes, /CONTENT_VIEW_DEDUPE_WINDOW_MS/);
  assert.doesNotMatch(analyticsRoutes, /isPlaybackSessionActive/);
  assert.doesNotMatch(analyticsRoutes, /payments|transactions|earnings/i);

  assert.match(artistAnalytics, /FROM analytics_events e/);
  assert.match(artistAnalytics, /e\.event_type = 'PLAY_STARTED'/);
  assert.match(artistAnalytics, /JOIN subscriptions s ON s\.id = p\.subscription_id/);
  assert.match(artistAnalytics, /WHERE s\.artist_id = \$1/);
  assert.match(artistAnalytics, /WHERE c\.artist_id = \$1/);
  assert.doesNotMatch(artistAnalytics, /FROM content_plays/);
  assert.doesNotMatch(artistAnalytics, /safeRows|safeScalar|\*\s*0\.9|\*\s*0\.1/);

  const strictPricingMount = app.indexOf('app.use("/api/v1/artist", artistPricingRoutes)');
  const strictAnalyticsMount = app.indexOf('app.use("/api/v1/artist", artistAnalyticsRoutes)');
  const legacyArtistMount = app.indexOf('app.use("/api/v1/artist", artistRoutes)');
  assert.ok(strictPricingMount >= 0 && strictPricingMount < legacyArtistMount);
  assert.ok(strictAnalyticsMount >= 0 && strictAnalyticsMount < legacyArtistMount);
}

function testAuditDurabilityContracts() {
  const audit = readBackend("shared/audit/audit.service.ts");
  const artistApproval = readBackend("modules/artist/artist-approval.service.ts");
  const artistApprovalRoutes = readBackend("routes/admin/artist-approvals.ts");
  const artistPricing = readBackend("modules/artist/artist-pricing.routes.ts");
  const adminGovernance = readBackend("modules/admin/admin-governance-config.routes.ts");
  const adminArtistGovernance = readBackend("modules/admin/admin-artist-governance.routes.ts");
  const adminAgreement = readBackend("modules/admin/admin-artist-agreement.routes.ts");
  const adminIndex = readBackend("routes/admin/index.ts");
  const accountState = readBackend("common/auth/account-state.service.ts");
  const accountSecurity = readBackend("routes/admin/account-security.ts");
  const password = readBackend("modules/user/password.controller.ts");

  assert.match(audit, /static async logCritical/);
  assert.match(audit, /SENSITIVE_KEY/);
  assert.match(audit, /\[REDACTED\]/);

  assert.match(artistApproval, /AuditService\.logCritical\([\s\S]*?client\s*\)/);
  assert.match(artistApproval, /await client\.query\("COMMIT"\)/);
  assert.doesNotMatch(artistApprovalRoutes, /AuditService\.log\(/);
  assert.doesNotMatch(artistApprovalRoutes, /const safeQuery/);

  assert.match(artistPricing, /AuditService\.logCritical\([\s\S]*?client\s*\)/);
  assert.match(adminGovernance, /AuditService\.logCritical/g);
  assert.match(adminArtistGovernance, /AuditService\.logCritical/g);
  assert.match(adminAgreement, /AuditService\.logCritical/g);

  const configMount = adminIndex.indexOf("adminGovernanceConfigRoutes");
  const agreementMount = adminIndex.indexOf("adminArtistAgreementRoutes");
  const governanceMount = adminIndex.indexOf("adminArtistGovernanceRoutes");
  const legacyMount = adminIndex.lastIndexOf("adminArtistsRoutes");
  assert.ok(configMount >= 0 && configMount < legacyMount);
  assert.ok(agreementMount >= 0 && agreementMount < legacyMount);
  assert.ok(governanceMount >= 0 && governanceMount < legacyMount);

  assert.match(accountState, /AuditService\.logCritical\([\s\S]*?client\s*\)/);
  assert.match(accountState, /revokeArtistSessions/);
  assert.match(accountState, /writeStateAudit/);
  assert.doesNotMatch(accountSecurity, /AuditService\.log\(/);
  assert.match(accountSecurity, /auditContext\(req/);

  const passwordAudit = password.indexOf("await AuditService.logCritical");
  const passwordCommit = password.indexOf('await client.query("COMMIT")');
  assert.ok(passwordAudit >= 0 && passwordAudit < passwordCommit);
  assert.doesNotMatch(password, /AuditService\.log\(/);
}

function testJobsAndSchemaContracts() {
  const jobs = readBackend("runtime/operational-job-claim.ts");
  const schedulers = readBackend("runtime/subscription-schedulers.ts");
  const schema = readBackend("common/db/schema-readiness.ts");
  const migration = readRepo(
    "backend/db/migrations/20260913_0010_analytics_audit_operational_integrity.sql"
  );

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
}

function testFinancialAndUiContracts() {
  const adminAnalytics = readBackend("controllers/adminAnalyticsController.ts");
  const adminAnalyticsRoutes = readBackend("routes/admin/analytics.ts");
  const adminUi = readRepo("web-admin/src/pages/AdminAnalyticsPage.tsx");
  const adminHome = readRepo("web-admin/src/pages/AdminHomePage.tsx");
  const artistUi = readRepo("web-artist/src/pages/ArtistAnalyticsSummaryPage.tsx");

  assert.doesNotMatch(adminAnalytics, /Math\.max\(paymentsRevenue, transactionsRevenue\)/);
  assert.doesNotMatch(adminAnalytics, /ANALYTICS-DEBUG|_debug/);
  assert.match(adminAnalytics, /FROM payments/);
  assert.doesNotMatch(adminAnalyticsRoutes, /Math\.max\(|transactionsRevenue|transactionRows/);
  assert.doesNotMatch(adminAnalyticsRoutes, /_debug/);
  assert.match(adminAnalyticsRoutes, /FROM payments/);
  assert.match(adminAnalyticsRoutes, /analytics_events e/);
  assert.match(adminAnalyticsRoutes, /e\.event_type = 'PLAY_STARTED'/);
  assert.doesNotMatch(adminAnalyticsRoutes, /content_plays/);

  assert.doesNotMatch(adminUi, /totalRevenue\s*\*\s*0\.[19]/);
  assert.match(adminUi, /Payment ledger only/);
  assert.match(adminUi, /Analytics unavailable/);
  assert.match(adminUi, /status === 403/);

  assert.doesNotMatch(adminHome, /12\.5%|8\.2%|5\.7%|24\.8%|3\.1%/);
  assert.match(adminHome, /Dashboard unavailable/);
  assert.match(adminHome, /status === 403/);

  assert.doesNotMatch(artistUi, /\*\s*0\.9|\*\s*0\.1/);
  assert.match(artistUi, /Gross captured revenue/);
  assert.match(artistUi, /Analytics could not be loaded/);
  assert.match(artistUi, /Payment ledger; not payout estimate/);
}

function testTelemetryRedactionContracts() {
  const backendLogger = readBackend("common/logger.ts");
  const backendSentry = readBackend("common/sentry.ts");
  const mobileLogger = readRepo("mobile/apps/fan/src/utils/logger.ts");
  const mobileSentry = readRepo("mobile/apps/fan/src/utils/sentrySanitizer.ts");
  const mobileApp = readRepo("mobile/App.tsx");
  const adminSentry = readRepo("web-admin/src/services/sentrySanitizer.ts");
  const adminMain = readRepo("web-admin/src/main.tsx");
  const artistSentry = readRepo("web-artist/src/services/sentrySanitizer.ts");
  const artistMain = readRepo("web-artist/src/main.tsx");

  assert.match(backendLogger, /split\('\?'\)\[0\]/);
  assert.doesNotMatch(backendLogger, /query:\s*req\.query/);
  assert.match(backendSentry, /request\.query_string = undefined/);
  assert.match(backendSentry, /request\.data = undefined/);
  assert.match(backendSentry, /SENSITIVE_HEADER/);

  assert.match(mobileLogger, /SENSITIVE_KEY/);
  assert.match(mobileLogger, /REDACTED_JWT/);
  assert.match(mobileSentry, /request\.query_string = undefined/);
  assert.match(mobileSentry, /request\.data = undefined/);
  assert.match(mobileApp, /beforeSend\(event\)/);
  assert.match(mobileApp, /sanitizeSentryEvent\(event\)/);

  assert.match(adminSentry, /request\.query_string = undefined/);
  assert.match(adminMain, /beforeSend\(event\)/);
  assert.match(adminMain, /sanitizeSentryEvent\(event\)/);
  assert.match(artistSentry, /request\.query_string = undefined/);
  assert.match(artistMain, /beforeSend\(event\)/);
  assert.match(artistMain, /sanitizeSentryEvent\(event\)/);
}

function run() {
  testHeartbeatPolicy();
  testPlaybackAndAnalyticsContracts();
  testAuditDurabilityContracts();
  testJobsAndSchemaContracts();
  testFinancialAndUiContracts();
  testTelemetryRedactionContracts();
  console.log("Phase 08 operational integrity checks passed.");
}

run();
