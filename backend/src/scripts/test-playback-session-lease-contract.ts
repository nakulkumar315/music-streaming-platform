import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(SRC, relativePath), "utf8");

function testAccessSupportsExplicitLeaseReuse() {
  const service = read("modules/media/media-access.service.ts");

  assert.match(service, /sessionId\?: number/);
  assert.match(service, /refreshPlaybackSessionLease/);
  assert.match(service, /sessionReused: !createdNewSession/);
  assert.doesNotMatch(service, /recordPlaybackStarted/);
  assert.match(service, /trusted heartbeat path/);
  assert.match(service, /if \(createdNewSession\) \{\s*await discardPlaybackSession/s);
  assert.match(service, /"PLAYBACK_SESSION_EXPIRED"/);

  assert.doesNotMatch(service, /latest.*session|most recent.*session/i);
}

function testLeaseRefreshIsOwnedAndContentScoped() {
  const sessions = read("shared/security/playback-session.service.ts");
  const refreshBlock = sessions.match(
    /export async function refreshPlaybackSessionLease[\s\S]*?return result\.rows\[0\]\?\.heartbeat_at \?\? null;/
  )?.[0];

  assert.ok(refreshBlock, "refreshPlaybackSessionLease must exist");
  assert.match(refreshBlock, /WHERE id = \$1/);
  assert.match(refreshBlock, /user_id = \$2/);
  assert.match(refreshBlock, /content_id = \$3/);
  assert.match(refreshBlock, /ended_at IS NULL/);
  assert.match(refreshBlock, /heartbeat_at > now\(\) - interval '5 minutes'/);
  assert.doesNotMatch(refreshBlock, /INSERT INTO playback_sessions/);
  assert.doesNotMatch(refreshBlock, /analytics_heartbeat_at\s*=/);
}

function testHeartbeatIsSequencedAndOwned() {
  const routes = read("modules/streaming/stream.routes.ts");
  const sessions = read("shared/security/playback-session.service.ts");
  assert.match(routes, /positiveInteger\(req\.body\?\.sequence\)/);
  assert.match(routes, /heartbeatEntitlementAllowed/);
  assert.match(routes, /PLAYBACK_SESSION_REVOKED/);
  assert.match(sessions, /FOR UPDATE/);
  assert.match(sessions, /last_heartbeat_sequence/);
  assert.match(sessions, /duplicateOrReplay/);
  assert.match(sessions, /trusted_listened_seconds = trusted_listened_seconds \+ \$7/);
  assert.match(sessions, /ON CONFLICT \(playback_session_id\)/);
  assert.match(sessions, /user_listening_stats/);
}

function testStreamAccessPassesOnlyRequestedSession() {
  const routes = read("modules/streaming/stream.routes.ts");
  assert.match(routes, /const hasSessionId/);
  assert.match(routes, /sessionId = hasSessionId \? positiveInteger\(req\.body\?\.sessionId\) : undefined/);
  assert.match(routes, /requestPlaybackAccess\(\{[\s\S]*?sessionId,[\s\S]*?kind,/);
  assert.match(routes, /code: "INVALID_PLAYBACK_SESSION"/);
}

function run() {
  testAccessSupportsExplicitLeaseReuse();
  testLeaseRefreshIsOwnedAndContentScoped();
  testHeartbeatIsSequencedAndOwned();
  testStreamAccessPassesOnlyRequestedSession();
  console.log("test-playback-session-lease-contract: all assertions passed");
}

run();
