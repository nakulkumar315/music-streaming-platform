import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const REPO = path.resolve(SRC, "..", "..");
const readBackend = (relativePath: string) =>
  fs.readFileSync(path.join(SRC, relativePath), "utf8");
const readRepo = (relativePath: string) =>
  fs.readFileSync(path.join(REPO, relativePath), "utf8");

function testMobileLeaseRecovery() {
  const streamService = readRepo("mobile/apps/fan/src/services/streamService.ts");
  const heartbeat = readRepo("mobile/apps/fan/src/services/heartbeatService.ts");
  const app = readRepo("mobile/App.tsx");

  assert.match(streamService, /lastValidatedAtMs/);
  assert.match(streamService, /ACTIVE_LEASE_LOCAL_FRESHNESS_MS = 4 \* 60 \* 1000/);
  assert.match(streamService, /export function markActivePlaybackLeaseAlive/);
  assert.match(streamService, /export async function ensureActivePlaybackLease/);
  assert.match(streamService, /export async function reacquireExpiredPlaybackLease/);
  assert.match(streamService, /getPlaybackAccess\([\s\S]*existing\.sessionId/);
  assert.match(streamService, /PLAYBACK_SESSION_EXPIRED/);
  assert.match(streamService, /PLAYBACK_SESSION_MISMATCH/);

  assert.match(heartbeat, /let heartbeatInFlight = false/);
  assert.match(heartbeat, /await ensureActivePlaybackLease\(contentId\)/);
  assert.match(heartbeat, /markActivePlaybackLeaseAlive\(lease\.sessionId\)/);
  assert.match(heartbeat, /await reacquireExpiredPlaybackLease\(contentId\)/);
  assert.match(heartbeat, /shouldStopHeartbeatForAuthorization/);
  assert.match(heartbeat, /status === 401/);
  assert.match(heartbeat, /status === 403/);

  const stopStart = heartbeat.indexOf("export function stopHeartbeat");
  const stopEnd = heartbeat.indexOf("/** Check if heartbeat", stopStart);
  assert.ok(stopStart >= 0 && stopEnd > stopStart);
  const stopSource = heartbeat.slice(stopStart, stopEnd);
  assert.doesNotMatch(stopSource, /heartbeatSequence\s*=\s*0/);
  assert.doesNotMatch(stopSource, /heartbeatSessionId\s*=\s*null/);

  assert.match(app, /function PlaybackHeartbeatLifecycleBridge\(\)/);
  assert.match(app, /startHeartbeat\(/);
  assert.match(app, /stopHeartbeat\(\)/);
}

function testTrustedSelfListeningOwnership() {
  const fanIndex = readBackend("routes/fan/index.ts");
  const listenTime = readBackend("modules/user/listen-time.routes.ts");
  const legacyUserRoutes = readBackend("modules/user/user.routes.ts");

  const strictMount = fanIndex.indexOf("trustedListenTimeRoutes");
  const legacyMount = fanIndex.lastIndexOf("userRoutes");
  assert.ok(strictMount >= 0 && legacyMount >= 0 && strictMount < legacyMount);

  assert.match(listenTime, /const userId = Number\(req\.user\?\.id\)/);
  assert.match(listenTime, /FROM user_listening_stats/);
  assert.match(listenTime, /WHERE user_id = \$1/);
  assert.match(listenTime, /source: "trusted_heartbeat"/);
  assert.doesNotMatch(listenTime, /req\.params|req\.query/);
  assert.doesNotMatch(listenTime, /playback_sessions|content_plays|\*\s*180|estimated_seconds/i);

  // The legacy handler may remain for compatibility, but the strict router must
  // shadow its exact URL before userRoutes is reached.
  assert.match(legacyUserRoutes, /router\.get\("\/listen-time"/);
}

function testClientCannotManufactureTrustedPlays() {
  const analytics = readBackend("modules/analytics/analytics.routes.ts");
  const sessions = readBackend("shared/security/playback-session.service.ts");
  const artistAnalytics = readBackend("modules/artist/artist-analytics.routes.ts");
  const adminAnalytics = readBackend("routes/admin/analytics.ts");

  assert.match(analytics, /CLIENT_EVENT_TYPES = new Set\(\["CONTENT_VIEWED"\]\)/);
  assert.doesNotMatch(analytics, /isPlaybackSessionActive/);
  assert.match(sessions, /VALUES \('PLAY_STARTED'/);
  assert.match(sessions, /acceptedSeconds > 0/);

  assert.match(artistAnalytics, /FROM analytics_events e/);
  assert.match(artistAnalytics, /e\.event_type = 'PLAY_STARTED'/);
  assert.doesNotMatch(artistAnalytics, /FROM content_plays/);

  assert.match(adminAnalytics, /analytics_events e/);
  assert.match(adminAnalytics, /e\.event_type = 'PLAY_STARTED'/);
  assert.doesNotMatch(adminAnalytics, /content_plays/);
}

function run() {
  testMobileLeaseRecovery();
  testTrustedSelfListeningOwnership();
  testClientCannotManufactureTrustedPlays();
  console.log("Phase 08 mobile/ownership contract checks passed.");
}

run();
