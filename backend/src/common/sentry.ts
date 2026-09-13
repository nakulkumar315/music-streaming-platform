import * as Sentry from "@sentry/node";
import type { EnvValidationResult } from "../config/env.validation";

let enabled = false;

const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|x-auth-token|x-api-key)$/i;

function pathWithoutQuery(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.split("?")[0];
}

function redactEvent(event: Sentry.Event): Sentry.Event {
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

  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      const data = breadcrumb.data;
      if (!data) continue;
      if (typeof data.url === "string") data.url = pathWithoutQuery(data.url);
      if (typeof data.to === "string") data.to = pathWithoutQuery(data.to);
      if (typeof data.from === "string") data.from = pathWithoutQuery(data.from);
      for (const key of Object.keys(data)) {
        if (SENSITIVE_HEADER.test(key) || /(?:token|secret|signature|password)/i.test(key)) {
          delete data[key];
        }
      }
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
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}
