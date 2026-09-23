import * as Sentry from "@sentry/node";
import type { EnvValidationResult } from "../config/env.validation";

let enabled = false;

const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|x-auth-token|x-api-key)$/i;
const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|token|secret|signature|signed.?url|playback.?url|media.?url|razorpay.?key|razorpay.?secret|card|cvv)/i;
const SENSITIVE_QUERY_PARAM = /([?&](?:token|signature|secret|key|authorization)=)[^&\s]+/gi;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+/gi;

function pathWithoutQuery(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.split("?")[0];
}

function sanitizeString(value: string): string {
  return value
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(SENSITIVE_QUERY_PARAM, "$1[REDACTED]")
    .replace(JWT_LIKE, "[REDACTED_JWT]");
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeString(value.message) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : sanitizeValue(nested, depth + 1);
    }
    return output;
  }
  return sanitizeString(String(value));
}

function redactEvent<T extends Sentry.ErrorEvent>(event: T): T {
  const request = event.request;
  if (request) {
    if (request.url) request.url = pathWithoutQuery(request.url);
    request.query_string = undefined;
    request.data = undefined;

    if (request.headers) {
      for (const key of Object.keys(request.headers)) {
        if (SENSITIVE_HEADER.test(key)) delete request.headers[key];
      }
    }
  }

  if (typeof event.message === "string") {
    event.message = sanitizeString(event.message);
  }

  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") {
      exception.value = sanitizeString(exception.value);
    }
  }

  if (event.extra) {
    event.extra = sanitizeValue(event.extra) as typeof event.extra;
  }

  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (typeof breadcrumb.message === "string") {
        breadcrumb.message = sanitizeString(breadcrumb.message);
      }
      const data = breadcrumb.data;
      if (!data) continue;
      if (typeof data.url === "string") data.url = pathWithoutQuery(data.url);
      if (typeof data.to === "string") data.to = pathWithoutQuery(data.to);
      if (typeof data.from === "string") data.from = pathWithoutQuery(data.from);
      breadcrumb.data = sanitizeValue(data) as typeof breadcrumb.data;
    }
  }

  return event;
}

/** Initialize monitoring only from the already-validated runtime contract. */
export function initSentry(runtime: EnvValidationResult): void {
  if (!runtime.sentryDsn) {
    enabled = false;
    return;
  }

  Sentry.init({
    dsn: runtime.sentryDsn,
    environment: runtime.nodeEnv,
    release: runtime.sentryRelease || undefined,
    tracesSampleRate: runtime.nodeEnv === "production" ? 0.2 : 1.0,
    beforeSend(event) {
      return redactEvent(event);
    },
  });
  enabled = true;
}

/** Capture an error explicitly; safe when monitoring is disabled. */
export function captureError(
  err: unknown,
  context?: Record<string, unknown>
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context) {
      const safeContext = sanitizeValue(context);
      if (safeContext && typeof safeContext === "object" && !Array.isArray(safeContext)) {
        scope.setExtras(safeContext as Record<string, unknown>);
      }
    }
    Sentry.captureException(err);
  });
}
