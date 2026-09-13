const PLACEHOLDER = /(replace[-_ ]?me|change[-_ ]?me|changeme|placeholder|your[-_ ]?|example)/i;

function value(input) {
  return String(input ?? "").trim();
}

function parseHttpUrl(name, raw) {
  let parsed;
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

function isLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function validateProductionWebConfig(env) {
  const apiValue = value(env.VITE_API_BASE_URL);
  if (!apiValue) throw new Error("[config] VITE_API_BASE_URL is required in production");

  const api = parseHttpUrl("VITE_API_BASE_URL", apiValue);
  if (api.pathname !== "/" || api.search || api.hash) {
    throw new Error("[config] VITE_API_BASE_URL must be an origin without path/query/hash");
  }
  if (api.protocol !== "https:") {
    throw new Error("[config] VITE_API_BASE_URL must use https:// in production");
  }
  if (isLocalHost(api.hostname)) {
    throw new Error("[config] VITE_API_BASE_URL must not target localhost in production");
  }

  const sentryDsn = value(env.VITE_SENTRY_DSN);
  if (sentryDsn) {
    if (PLACEHOLDER.test(sentryDsn)) {
      throw new Error("[config] VITE_SENTRY_DSN contains a placeholder value");
    }
    const sentry = parseHttpUrl("VITE_SENTRY_DSN", sentryDsn);
    if (sentry.protocol !== "https:") {
      throw new Error("[config] VITE_SENTRY_DSN must use https:// in production");
    }
  }

  const sentryRelease = value(env.VITE_SENTRY_RELEASE);
  if (sentryRelease && PLACEHOLDER.test(sentryRelease)) {
    throw new Error("[config] VITE_SENTRY_RELEASE contains a placeholder value");
  }

  return { apiBaseUrl: api.origin };
}
