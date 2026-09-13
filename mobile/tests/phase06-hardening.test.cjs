const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));

test('release networking fails closed on Android and iOS', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.expo.android.usesCleartextTraffic, false);
  assert.equal(
    app.expo.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads,
    false
  );

  const env = read('apps/fan/src/config/env.ts');
  assert.match(env, /must use https:\/\/ outside local development/);
  assert.match(env, /APP_ENV === 'development' \|\| APP_ENV === 'test'/);
});

test('playback remains server-authoritative and validates issued URLs', () => {
  const stream = read('apps/fan/src/services/streamService.ts');
  assert.match(stream, /apiV1\.post<StreamAccessResponse>\('\/stream\/access'/);
  assert.match(stream, /data\?\.playbackUrl/);
  assert.match(stream, /validatePlaybackUrl\(normalized, kind\)/);
  assert.doesNotMatch(stream, /fallback.*(?:media|stream|url)/i);
  assert.doesNotMatch(stream, /AsyncStorage/);
});

test('production guest experience has no committed mock catalog or diagnostics screen', () => {
  assert.equal(exists('apps/fan/src/mocks/guestCatalog.ts'), false);
  assert.equal(exists('apps/fan/src/screens/DiagnosticsScreen.tsx'), false);

  const guestHome = read('apps/fan/src/screens/GuestHomeScreen.tsx');
  assert.doesNotMatch(guestHome, /mock.*catalog/i);
  assert.match(guestHome, /api|contentApi|searchApi/);
});

test('subscription success is gated by backend ACTIVE state', () => {
  const flow = read('apps/fan/src/screens/SubscriptionFlowScreen.tsx');
  assert.match(flow, /subscriptionStatus === "ACTIVE"/);
  assert.match(flow, /apiV1\.get\(`\/subscriptions\/\$\{id\}`\)/);
  assert.match(flow, /Verified webhook state remains authoritative/);
  assert.doesNotMatch(flow, /set(?:Is)?Unlocked\s*\(/);
});

test('mobile tests are executable rather than a typecheck alias', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.cjs');
  assert.equal(pkg.scripts.verify, 'npm run typecheck && npm test');
});
