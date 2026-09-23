const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
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
    'PLAYBACK_SESSION_EXPIRED',
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

test('mobile playback keeps one server lease across heartbeats and token refresh', () => {
  const stream = read('apps/fan/src/services/streamService.ts');
  assert.match(stream, /let activePlaybackLease: ActivePlaybackLease \| null = null/);
  assert.match(stream, /existing\?\.sessionId/);
  assert.match(stream, /returnedSessionId !== sessionId/);
  assert.match(stream, /PLAYBACK_SESSION_MISMATCH/);
  assert.match(stream, /await releaseActivePlaybackLease\(\)/);
  assert.match(stream, /apiV1\.post\('\/stream\/terminate'/);

  const heartbeat = read('apps/fan/src/services/heartbeatService.ts');
  assert.match(heartbeat, /(?:getActivePlaybackLease|ensureActivePlaybackLease)\(contentId\)/);
  assert.match(heartbeat, /sessionId: lease\.sessionId/);
  assert.match(heartbeat, /apiV1\.post\('\/stream\/heartbeat'/);

  const app = read('App.tsx');
  assert.match(app, /PlaybackLeaseLifecycleBridge/);
  assert.match(app, /releaseActivePlaybackLease/);

  const provider = read('apps/fan/src/providers/MediaPlayerProvider.tsx');
  assert.equal(
    (provider.match(/preloadNextItem/g) || []).length,
    1,
    'protected playback preloading must stay inactive because access allocates a lease'
  );
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

test('secure storage and native release configuration are declared without stale push capability', () => {
  const app = JSON.parse(read('app.json'));
  assert.ok(app.expo.plugins.includes('expo-secure-store'));
  assert.equal(app.expo.plugins.includes('expo-notifications'), false);
  assert.deepEqual(app.expo.ios.infoPlist.UIBackgroundModes, ['audio']);

  const entitlements = read('ios/FanApp/FanApp.entitlements');
  assert.doesNotMatch(entitlements, /aps-environment/);

  assert.equal(exists('metro.config.js'), true);
  const metro = read('metro.config.js');
  assert.match(metro, /getSentryExpoConfig/);
  assert.match(metro, /@sentry\/react-native\/metro/);
});

test('native permissions and remote controls fail closed to implemented capabilities', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  for (const permission of [
    'RECORD_AUDIO',
    'SYSTEM_ALERT_WINDOW',
    'READ_EXTERNAL_STORAGE',
    'WRITE_EXTERNAL_STORAGE',
  ]) {
    assert.doesNotMatch(manifest, new RegExp(permission));
  }

  const infoPlist = read('ios/FanApp/Info.plist');
  assert.doesNotMatch(infoPlist, /NSMicrophoneUsageDescription/);
  assert.doesNotMatch(infoPlist, /NSCameraUsageDescription/);
  assert.match(infoPlist, /NSPhotoLibraryUsageDescription/);
  assert.match(infoPlist, /<string>audio<\/string>/);
  assert.doesNotMatch(infoPlist, /<string>fetch<\/string>/);

  const gradle = read('android/app/build.gradle');
  const releaseBlock = gradle.match(/release\s*\{([\s\S]*?)\n\s*\}\n\s*\}/)?.[1] ?? '';
  assert.ok(releaseBlock, 'release build block should exist');
  assert.doesNotMatch(releaseBlock, /signingConfig\s+signingConfigs\.debug/);

  const service = read('apps/fan/src/services/playbackService.ts');
  assert.match(service, /TrackPlayer\.updateOptions/);
  assert.doesNotMatch(service, /Capability\.SkipToNext/);
  assert.doesNotMatch(service, /Capability\.SkipToPrevious/);
  assert.doesNotMatch(service, /Event\.RemoteNext/);
  assert.doesNotMatch(service, /Event\.RemotePrevious/);
});

test('mobile tests are executable rather than a typecheck alias', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts.test.startsWith('node --test'));
  assert.equal(pkg.scripts.verify, 'npm run typecheck && npm test');
});
