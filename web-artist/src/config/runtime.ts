const PLACEHOLDER = /(replace[-_ ]?me|change[-_ ]?me|changeme|placeholder|your[-_ ]?|example)/i;

export type ArtistRuntimeConfig = {
  apiBaseUrl: string;
  sentryDsn: string | null;
  sentryRelease: string | null;
  production: boolean;
};

function value(input: unknown) {
  return String(input ?? "").trim();
}

function parseHttpUrl(name: string, raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`[config] ${name} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`[config] ${name} must use http:// or https://`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`[config] ${name} must not contain credentials`);
  }
  return parsed;
}

function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function validateArtistRuntimeConfig(input: {
  production: boolean;
  apiBaseUrl?: unknown;
  sentryDsn?: unknown;
  sentryRelease?: unknown;
}): ArtistRuntimeConfig {
  const configuredApi = value(input.apiBaseUrl);
  if (input.production && !configuredApi) {
    throw new Error("[config] VITE_API_BASE_URL is required in production");
  }
  const api = parseHttpUrl("VITE_API_BASE_URL", configuredApi || "http://localhost:8000");
  if (api.pathname !== "/" || api.search || api.hash) {
    throw new Error("[config] VITE_API_BASE_URL must be an origin without path/query/hash");
  }
  if (input.production && api.protocol !== "https:") {
    throw new Error("[config] VITE_API_BASE_URL must use https:// in production");
  }
  if (input.production && isLocalHost(api.hostname)) {
    throw new Error("[config] VITE_API_BASE_URL must not target localhost in production");
  }

  const rawSentryDsn = value(input.sentryDsn);
  let sentryDsn: string | null = null;
  if (rawSentryDsn) {
    if (PLACEHOLDER.test(rawSentryDsn)) {
      throw new Error("[config] VITE_SENTRY_DSN contains a placeholder value");
    }
    const parsed = parseHttpUrl("VITE_SENTRY_DSN", rawSentryDsn);
    if (input.production && parsed.protocol !== "https:") {
      throw new Error("[config] VITE_SENTRY_DSN must use https:// in production");
    }
    sentryDsn = parsed.toString();
  }

  const rawRelease = value(input.sentryRelease);
  if (rawRelease && PLACEHOLDER.test(rawRelease)) {
    throw new Error("[config] VITE_SENTRY_RELEASE contains a placeholder value");
  }

  return {
    apiBaseUrl: api.origin,
    sentryDsn,
    sentryRelease: rawRelease || null,
    production: input.production,
  };
}

export const artistRuntimeConfig = validateArtistRuntimeConfig({
  production: import.meta.env.PROD,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  sentryDsn: import.meta.env.VITE_SENTRY_DSN,
  sentryRelease: import.meta.env.VITE_SENTRY_RELEASE,
});
