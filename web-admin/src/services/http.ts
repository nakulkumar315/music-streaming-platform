import axios from "axios";
import * as Sentry from "@sentry/react";

const ADMIN_DEVICE_ID_KEY = "adminDeviceId";

function getOrCreateDeviceId() {
  const existing = localStorage.getItem(ADMIN_DEVICE_ID_KEY);
  if (existing) return existing;

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `admin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(ADMIN_DEVICE_ID_KEY, generated);
  return generated;
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
});

http.interceptors.request.use((config) => {
  config.headers = config.headers ?? {};
  (config.headers as any)["X-Device-Id"] = getOrCreateDeviceId();

  const token = localStorage.getItem("adminToken");
  if (token) {
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

let lastRateLimitAlertAt = 0;

http.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;

    // 401 means the token/session is no longer valid. A 403 means the user is
    // authenticated but lacks permission and must not be silently logged out.
    if (status === 401) {
      localStorage.removeItem("adminToken");
      if (typeof window !== "undefined") {
        window.location.href = "/admin/login";
      }
    }

    if (status === 429) {
      const now = Date.now();
      if (now - lastRateLimitAlertAt > 10_000) {
        lastRateLimitAlertAt = now;
        if (typeof window !== "undefined") {
          window.alert("Too many requests. Please wait a few seconds and try again.");
        }
      }
    }

    if (status >= 500) {
      Sentry.captureException(error, { extra: { status, url: error.config?.url } });
    }

    return Promise.reject(error);
  }
);
