export type MobileRuntimeEnvironment = 'development' | 'test' | 'preview' | 'production';

function runtimeEnvironment(): MobileRuntimeEnvironment {
  const configured = String(process.env.EXPO_PUBLIC_APP_ENV || '').trim().toLowerCase();
  if (configured === 'development' || configured === 'test' || configured === 'preview' || configured === 'production') {
    return configured;
  }

  // Expo/Metro replaces __DEV__ at bundle time. Treat an unlabelled release
  // bundle as production so permissive development behavior cannot leak.
  return typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'production';
}

export const APP_ENV = runtimeEnvironment();
export const IS_PRODUCTION_LIKE = APP_ENV === 'production' || APP_ENV === 'preview';

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '10.0.2.2') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;

  const match = host.match(/^172\.(\d{1,3})\./);
  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }

  return false;
}

export function validateMobileHttpUrl(key: string, rawValue: string | undefined): string {
  const raw = String(rawValue || '').trim();
  if (!raw) throw new Error(`Missing ${key}. Define it before running or building the app.`);

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${key} must be a valid absolute URL.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${key} must not embed credentials.`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${key} must use https:// (or local http:// in development).`);
  }

  if (parsed.protocol === 'http:') {
    const localDevAllowed =
      (APP_ENV === 'development' || APP_ENV === 'test') && isPrivateOrLocalHost(parsed.hostname);
    if (!localDevAllowed) {
      throw new Error(`${key} must use https:// outside local development.`);
    }
  }

  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

export function isAllowedPlaybackUrl(rawValue: string): boolean {
  const raw = String(rawValue || '').trim();
  if (!raw) return false;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'http:') return false;

  return (
    (APP_ENV === 'development' || APP_ENV === 'test') &&
    isPrivateOrLocalHost(parsed.hostname)
  );
}

export const API_HOST_BASE_URL = validateMobileHttpUrl(
  'EXPO_PUBLIC_API_URL',
  process.env.EXPO_PUBLIC_API_URL
);

export const ARTIST_WEB_URL = validateMobileHttpUrl(
  'EXPO_PUBLIC_ARTIST_WEB_URL',
  process.env.EXPO_PUBLIC_ARTIST_WEB_URL
);

const sentryDsnRaw = String(process.env.EXPO_PUBLIC_SENTRY_DSN || '').trim();
export const SENTRY_DSN = sentryDsnRaw
  ? validateMobileHttpUrl('EXPO_PUBLIC_SENTRY_DSN', sentryDsnRaw)
  : null;

export const SENTRY_RELEASE = String(process.env.EXPO_PUBLIC_SENTRY_RELEASE || '').trim() || null;
if (IS_PRODUCTION_LIKE && SENTRY_DSN && !SENTRY_RELEASE) {
  throw new Error('EXPO_PUBLIC_SENTRY_RELEASE is required when Sentry is enabled in preview/production.');
}
