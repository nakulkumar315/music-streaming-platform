import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const LEGACY_JWT_STORAGE_KEY = 'jwt';
export const LEGACY_USER_TOKEN_STORAGE_KEY = 'userToken';

const SECURE_AUTH_CREDENTIAL_KEY = 'fan.auth.session.v1';
const LOCAL_LOGOUT_TOMBSTONE_KEY = 'fan.auth.logout-pending.v1';
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'fan-auth-session',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

let webMemoryCredential: string | null = null;

function isNativeMobile() {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

async function assertSecureStoreAvailable() {
  if (!isNativeMobile()) return;
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    throw new Error('Secure credential storage is unavailable on this device.');
  }
}

async function clearLegacyCredentialCopies() {
  await Promise.all([
    AsyncStorage.removeItem(LEGACY_USER_TOKEN_STORAGE_KEY),
    AsyncStorage.removeItem(LEGACY_JWT_STORAGE_KEY),
  ]);
}

async function readLegacyCredential() {
  return (
    (await AsyncStorage.getItem(LEGACY_USER_TOKEN_STORAGE_KEY)) ??
    (await AsyncStorage.getItem(LEGACY_JWT_STORAGE_KEY))
  );
}

async function deleteNativeSecureCredential() {
  await assertSecureStoreAvailable();
  await SecureStore.deleteItemAsync(
    SECURE_AUTH_CREDENTIAL_KEY,
    SECURE_STORE_OPTIONS
  );
}

/**
 * Reads the durable auth credential from platform secure storage.
 *
 * A one-time migration preserves existing mobile sessions: a legacy plaintext
 * token is copied to SecureStore, read back for verification, and only then
 * removed from AsyncStorage. If secure persistence fails we fail closed rather
 * than continuing to use the plaintext token.
 *
 * A non-secret logout tombstone prevents a credential that could not be deleted
 * from being restored on the next launch. We retry deletion before any token is
 * returned and remain logged out if the OS secure store is unavailable.
 */
export async function readAuthCredential(): Promise<string | null> {
  if (!isNativeMobile()) {
    return webMemoryCredential;
  }

  const logoutPending = await AsyncStorage.getItem(LOCAL_LOGOUT_TOMBSTONE_KEY);
  if (logoutPending === '1') {
    try {
      await deleteNativeSecureCredential();
      await clearLegacyCredentialCopies();
      await AsyncStorage.removeItem(LOCAL_LOGOUT_TOMBSTONE_KEY);
    } catch {
      // Fail closed: a credential that was meant to be deleted must never be
      // restored merely because native secure storage is temporarily failing.
      return null;
    }
    return null;
  }

  await assertSecureStoreAvailable();
  const secureCredential = await SecureStore.getItemAsync(
    SECURE_AUTH_CREDENTIAL_KEY,
    SECURE_STORE_OPTIONS
  );
  if (secureCredential) {
    // Clean up any stale plaintext copies left by an interrupted older session.
    await clearLegacyCredentialCopies();
    return secureCredential;
  }

  const legacyCredential = await readLegacyCredential();
  if (!legacyCredential) return null;

  await SecureStore.setItemAsync(
    SECURE_AUTH_CREDENTIAL_KEY,
    legacyCredential,
    SECURE_STORE_OPTIONS
  );

  const verifiedCredential = await SecureStore.getItemAsync(
    SECURE_AUTH_CREDENTIAL_KEY,
    SECURE_STORE_OPTIONS
  );
  if (verifiedCredential !== legacyCredential) {
    throw new Error('Secure credential migration could not be verified.');
  }

  await clearLegacyCredentialCopies();
  return verifiedCredential;
}

export async function saveAuthCredential(credential: string): Promise<void> {
  const normalized = credential.trim();
  if (!normalized) {
    throw new Error('Refusing to persist an empty auth credential.');
  }

  if (!isNativeMobile()) {
    webMemoryCredential = normalized;
    await clearLegacyCredentialCopies();
    return;
  }

  await assertSecureStoreAvailable();
  await SecureStore.setItemAsync(
    SECURE_AUTH_CREDENTIAL_KEY,
    normalized,
    SECURE_STORE_OPTIONS
  );
  await clearLegacyCredentialCopies();
  await AsyncStorage.removeItem(LOCAL_LOGOUT_TOMBSTONE_KEY);
}

export async function clearAuthCredential(): Promise<void> {
  webMemoryCredential = null;

  if (!isNativeMobile()) {
    await clearLegacyCredentialCopies();
    return;
  }

  // Record logout intent before touching secure storage. If native deletion
  // fails, readAuthCredential() will refuse to restore the stale credential.
  await AsyncStorage.setItem(LOCAL_LOGOUT_TOMBSTONE_KEY, '1');

  let secureStoreError: unknown = null;
  try {
    await deleteNativeSecureCredential();
  } catch (error) {
    secureStoreError = error;
  }

  // Always remove legacy plaintext copies, even if secure deletion failed.
  await clearLegacyCredentialCopies();

  if (!secureStoreError) {
    await AsyncStorage.removeItem(LOCAL_LOGOUT_TOMBSTONE_KEY);
    return;
  }

  throw secureStoreError;
}
