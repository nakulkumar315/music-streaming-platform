import * as Sentry from "@sentry/node";
import type { EnvValidationResult } from "../config/env.validation";

let enabled = false;

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
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
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
