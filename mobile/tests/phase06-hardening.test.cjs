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

test('playback remains server-authoritative and handles typed denial codes', () => {
  const stream = read('apps/fan/src/services/streamService.ts');
  assert.match(stream, /apiV1\.post<StreamAccessResponse>\('\/stream\/access'/);
  assert.match(stream, /data\?\.playbackUrl/);
  assert.match(stream, /validatePlaybackUrl\(normalized, kind\)/);
  assert.doesNotMatch(stream, /allowPreview/);
  assert.doesNotMatch(stream, /AsyncStorage/);

  for (const code of [
    'SUBSCRIPTION_REQUIRED',
    'SUBSCRIPTION_EXPIRED',
    'SUBSCRIPTION_INACTIVE',
    'CONTENT_TAKEN_DOWN',
    'PLAYBACK_SESSION_LIMIT',
    'PLAYBACK_ACCESS_EXPIRED',
    'INVALID_PLAYBACK_TOKEN',
  ]) {
    assert.match(stream, new RegExp(code));
  }

  const provider = read('apps/fan/src/providers/MediaPlayerProvider.tsx');
  assert.match(provider, /getPlaybackErrorPresentation/);
  assert.match(provider, /presentation\.shouldStopPlayback/);
  assert.match(provider, /Alert\.alert\(presentation\.title, presentation\.message\)/);
  assert.doesNotMatch(provider, /Could not get playback URL\. Try again\./);
});

test('production guest experience has no committed mock catalog or diagnostics screen', () => {
  assert.equal(exists('apps/fan/src/mocks/guestCatalog.ts'), false);
  assert.equal(exists('apps/fan/src/screens/DiagnosticsScreen.tsx'), false);

  const guestHome = read('apps/fan/src/screens/GuestHomeScreen.tsx');
  assert.doesNotMatch(guestHome, /mock.*catalog/i);
  assert.match(guestHome, /api|contentApi|searchApi/);
});

test('subscription success is backend ACTIVE-gated with no client entitlement navigation hint', () => {
  const flow = read('apps/fan/src/screens/SubscriptionFlowScreen.tsx');
  assert.match(flow, /subscriptionStatus === "ACTIVE"/);
  assert.match(flow, /apiV1\.get\(`\/subscriptions\/\$\{id\}`\)/);
  assert.match(flow, /Verified webhook state remains authoritative/);
  assert.doesNotMatch(flow, /set(?:Is)?Unlocked\s*\(/);
  assert.doesNotMatch(flow, /unlocked\s*:\s*true/);

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
  assert.match(storage, /hasLogoutTombstone/);
  assert.match(storage, /LOCAL_LOGOUT_TOMBSTONE_KEY/);
  assert.match(storage, /reason: CredentialWriteReason = 'session-rotation'/);
  assert.match(storage, /sessionRotationWritesAllowed = false/);
  assert.match(storage, /if \(!sessionRotationWritesAllowed\) return false/);
  assert.equal(
    (storage.match(/removeItem\(LOCAL_LOGOUT_TOMBSTONE_KEY\)/g) || []).length,
    1,
    'logout intent must only be cleared by a fresh successful credential save'
  );

  const api = read('apps/fan/src/services/api.ts');
  assert.match(api, /readAuthCredential/);
  assert.match(api, /saveAuthCredential\(rotatedToken\)/);
  assert.match(api, /clearAuthCredential/);
  assert.match(api, /__authCredentialUsed/);
  assert.match(api, /responseMatchesCurrentCredential/);
  assert.match(api, /status === 401 && \(await responseMatchesCurrentCredential\(config\)\)/);
  assert.match(api, /if \(await responseMatchesCurrentCredential\(config\)\) \{\s*await saveAuthCredential\(rotatedToken\)/s);
  assert.doesNotMatch(api, /AsyncStorage\.setItem\((?:USER_TOKEN_STORAGE_KEY|JWT_STORAGE_KEY)/);

  const authStore = read('apps/fan/src/store/authStore.ts');
  assert.match(authStore, /readAuthCredential/);
  assert.match(authStore, /saveAuthCredential\(next, 'fresh-auth'\)/);
  assert.match(authStore, /clearAuthCredential/);
  assert.doesNotMatch(authStore, /AsyncStorage\.(?:getItem|setItem)\((?:USER_TOKEN_STORAGE_KEY|JWT_STORAGE_KEY)/);
});

test('iOS native lock includes SecureStore and Metro is Sentry-aware', () => {
  const podLock = read('ios/Podfile.lock');
  assert.match(podLock, /ExpoSecureStore/);

  assert.equal(exists('metro.config.js'), true);
  const metro = read('metro.config.js');
  assert.match(metro, /getSentryExpoConfig/);
  assert.match(metro, /@sentry\/react-native\/metro/);
});

test('mobile tests are executable rather than a typecheck alias', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.cjs');
  assert.equal(pkg.scripts.verify, 'npm run typecheck && npm test');
});
