type TelemetryRequest = {
  url?: string;
  query_string?: unknown;
  data?: unknown;
  headers?: Record<string, unknown>;
};

type TelemetryBreadcrumb = {
  message?: string;
  data?: Record<string, unknown>;
};

type TelemetryExceptionValue = { value?: string };

type TelemetryEvent = {
  request?: TelemetryRequest;
  breadcrumbs?: TelemetryBreadcrumb[];
  exception?: { values?: TelemetryExceptionValue[] };
  message?: string;
  extra?: Record<string, unknown>;
};

const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|x-auth-token|x-api-key|password|passwd|token|secret|signature|signed.?url|playback.?url|media.?url|razorpay.?key|razorpay.?secret|card|cvv)/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+/gi;
const SENSITIVE_QUERY_PARAM = /([?&](?:token|signature|secret|key|authorization)=)[^&\s]+/gi;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function pathWithoutQuery(value: string) {
  return value.split("?")[0];
}

function sanitizeString(value: string) {
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
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeValue(nested, depth + 1);
    }
    return output;
  }
  return sanitizeString(String(value));
}

/** Remove credentials and signed-query material before telemetry leaves the browser. */
export function sanitizeSentryEvent<T extends TelemetryEvent>(event: T): T {
  if (event.request) {
    if (typeof event.request.url === "string") event.request.url = pathWithoutQuery(event.request.url);
    event.request.query_string = undefined;
    event.request.data = undefined;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_KEY.test(key)) delete event.request.headers[key];
      }
    }
  }

  if (typeof event.message === "string") event.message = sanitizeString(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") exception.value = sanitizeString(exception.value);
  }
  if (event.extra) event.extra = sanitizeValue(event.extra) as Record<string, unknown>;

  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (typeof breadcrumb.message === "string") breadcrumb.message = sanitizeString(breadcrumb.message);
    if (!breadcrumb.data) continue;
    for (const key of Object.keys(breadcrumb.data)) {
      const value = breadcrumb.data[key];
      if (SENSITIVE_KEY.test(key)) {
        delete breadcrumb.data[key];
      } else if (/^(url|to|from)$/i.test(key) && typeof value === "string") {
        breadcrumb.data[key] = pathWithoutQuery(value);
      } else {
        breadcrumb.data[key] = sanitizeValue(value);
      }
    }
  }

  return event;
}
