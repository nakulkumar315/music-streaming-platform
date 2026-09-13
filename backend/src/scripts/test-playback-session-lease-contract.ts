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
  assert.match(service, /if \(createdNewSession\) \{\s*void recordPlaybackStarted/s);
  assert.match(service, /if \(createdNewSession\) \{\s*await discardPlaybackSession/s);
  assert.match(service, /"PLAYBACK_SESSION_EXPIRED"/);

  // Refresh must be explicit. Reusing an arbitrary latest session for the same
  // user/content would allow two devices playing the same item to share a slot.
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
  testStreamAccessPassesOnlyRequestedSession();
  console.log("test-playback-session-lease-contract: all assertions passed");
}

run();
