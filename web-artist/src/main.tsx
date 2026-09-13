import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";
import { applyTheme, DEFAULT_THEME_ID } from "./services/themeConfig";
import { sanitizeSentryEvent } from "./services/sentrySanitizer";
import { artistRuntimeConfig } from "./config/runtime";

const savedTheme = localStorage.getItem("global-theme") || DEFAULT_THEME_ID;
applyTheme(savedTheme);

if (artistRuntimeConfig.sentryDsn) {
  Sentry.init({
    dsn: artistRuntimeConfig.sentryDsn,
    release: artistRuntimeConfig.sentryRelease ?? undefined,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: artistRuntimeConfig.production ? 0.1 : 1.0,
    beforeSend(event) {
      return sanitizeSentryEvent(event);
    },
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary label="Artist App">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>
);
