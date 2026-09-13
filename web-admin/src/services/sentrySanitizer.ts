type TelemetryRequest = {
  url?: string;
  query_string?: unknown;
  data?: unknown;
  headers?: Record<string, unknown>;
};

type TelemetryBreadcrumb = {
  data?: Record<string, unknown>;
};

type TelemetryEvent = {
  request?: TelemetryRequest;
  breadcrumbs?: TelemetryBreadcrumb[];
};

const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|x-auth-token|x-api-key|password|token|secret|signature)/i;

function pathWithoutQuery(value: string) {
  return value.split("?")[0];
}

/** Remove credentials and signed-query material before telemetry leaves the browser. */
export function sanitizeSentryEvent<T extends TelemetryEvent>(event: T): T {
  if (event.request) {
    if (typeof event.request.url === "string") {
      event.request.url = pathWithoutQuery(event.request.url);
    }
    event.request.query_string = undefined;
    event.request.data = undefined;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_KEY.test(key)) delete event.request.headers[key];
      }
    }
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (!breadcrumb.data) continue;
    for (const key of Object.keys(breadcrumb.data)) {
      const value = breadcrumb.data[key];
      if (SENSITIVE_KEY.test(key)) {
        delete breadcrumb.data[key];
      } else if (/^(url|to|from)$/i.test(key) && typeof value === "string") {
        breadcrumb.data[key] = pathWithoutQuery(value);
      }
    }
  }

  return event;
}
