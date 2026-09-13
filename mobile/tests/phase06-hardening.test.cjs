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
  assert.equal(app.expo.android.allowBackup, false);
  assert.equal(
    app.expo.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads,
    false
  );

  const env = read('apps/fan/src/config/env.ts');
  assert.match(env, /must use https:\/\/ outside local development/);
  assert.match(env, /APP_ENV === 'development' \|\| APP_ENV === 'test'/);

  const androidManifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(androidManifest, /android:allowBackup="false"/);
  assert.match(androidManifest, /android:usesCleartextTraffic="false"/);
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

test('subscription success is backend ACTIVE-gated and artist navigation strips local entitlement', () => {
  const flow = read('apps/fan/src/screens/SubscriptionFlowScreen.tsx');
  assert.match(flow, /subscriptionStatus === "ACTIVE"/);
  assert.match(flow, /apiV1\.get\(`\/subscriptions\/\$\{id\}`\)/);
  assert.match(flow, /Verified webhook state remains authoritative/);
  assert.doesNotMatch(flow, /set(?:Is)?Unlocked\s*\(/);

  const authoritativeArtist = read('apps/fan/src/navigation/AuthoritativeArtistScreen.tsx');
  assert.match(authoritativeArtist, /unlocked: _ignoredClientEntitlement/);
  assert.match(authoritativeArtist, /params: safeParams/);
});

test('durable auth credentials use SecureStore with verified legacy migration', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies['expo-secure-store'], '~15.0.8');

  const storage = read('apps/fan/src/security/credentialStorage.ts');
  assert.match(storage, /from 'expo-secure-store'/);
  assert.match(storage, /SecureStore\.setItemAsync/);
  assert.match(storage, /SecureStore\.getItemAsync/);
  assert.match(storage, /SecureStore\.deleteItemAsync/);
  assert.match(storage, /verifiedCredential !== legacyCredential/);
  assert.match(storage, /clearLegacyCredentialCopies/);
  assert.match(storage, /logoutPending === '1'/);
  assert.match(storage, /LOCAL_LOGOUT_TOMBSTONE_KEY/);
  assert.equal(
    (storage.match(/removeItem\(LOCAL_LOGOUT_TOMBSTONE_KEY\)/g) || []).length,
    1,
    'logout intent must only be cleared by a fresh successful credential save'
  );

  const api = read('apps/fan/src/services/api.ts');
  assert.match(api, /readAuthCredential/);
  assert.match(api, /saveAuthCredential/);
  assert.match(api, /clearAuthCredential/);
  assert.doesNotMatch(api, /AsyncStorage\.setItem\((?:USER_TOKEN_STORAGE_KEY|JWT_STORAGE_KEY)/);

  const authStore = read('apps/fan/src/store/authStore.ts');
  assert.match(authStore, /readAuthCredential/);
  assert.match(authStore, /saveAuthCredential/);
  assert.match(authStore, /clearAuthCredential/);
  assert.doesNotMatch(authStore, /AsyncStorage\.(?:getItem|setItem)\((?:USER_TOKEN_STORAGE_KEY|JWT_STORAGE_KEY)/);
});

test('mobile tests are executable rather than a typecheck alias', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.cjs');
  assert.equal(pkg.scripts.verify, 'npm run typecheck && npm test');
});
