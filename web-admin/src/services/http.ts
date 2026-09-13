import axios, { AxiosHeaders } from "axios";
import * as Sentry from "@sentry/react";
import { adminRuntimeConfig } from "../config/runtime";
import { clearAdminSession, getAdminToken, setAdminToken } from "./adminSession";

const ADMIN_DEVICE_ID_KEY = "adminDeviceId";

export type ApiFailure = {
  status: number;
  code: string | null;
  message: string;
  correlationId: string | null;
};

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

function requestPath(url: unknown) {
  return String(url || "").split("?")[0];
}

export function toApiFailure(error: unknown): ApiFailure {
  if (!axios.isAxiosError(error)) {
    return { status: 0, code: null, message: "Request failed", correlationId: null };
  }
  const body = error.response?.data as Record<string, unknown> | undefined;
  return {
    status: Number(error.response?.status || 0),
    code: typeof body?.code === "string" ? body.code : null,
    message:
      typeof body?.message === "string" && body.message.trim()
        ? body.message
        : error.response
          ? "Request failed"
          : "Unable to reach the server",
    correlationId:
      typeof body?.correlationId === "string" ? body.correlationId : null,
  };
}

export const http = axios.create({
  baseURL: adminRuntimeConfig.apiBaseUrl,
  timeout: 15_000,
  headers: {
    "Content-Type": "application/json",
  },
});

http.interceptors.request.use((config) => {
  const path = requestPath(config.url);
  const isLogin = path.includes("/api/v1/admin/login");

  if (isLogin && config.data && typeof config.data === "object") {
    config.data = { ...config.data, deviceId: getOrCreateDeviceId() };
  }

  if (!isLogin) {
    const token = getAdminToken();
    if (token) {
      const headers = AxiosHeaders.from(config.headers);
      headers.set("Authorization", `Bearer ${token}`);
      config.headers = headers;
    }
  }
  return config;
});

let lastRateLimitAlertAt = 0;

http.interceptors.response.use(
  (res) => {
    const path = requestPath(res.config?.url);
    if (path.includes("/api/v1/admin/login")) {
      const token = res.data?.token;
      if (typeof token === "string" && token.trim()) setAdminToken(token);
    }
    return res;
  },
  (error) => {
    const failure = toApiFailure(error);
    const path = requestPath(axios.isAxiosError(error) ? error.config?.url : "");
    const isLogin = path.includes("/api/v1/admin/login");

    if (failure.status === 401) {
      clearAdminSession();
      if (!isLogin && typeof window !== "undefined") {
        window.location.assign("/admin/login");
      }
    }

    if (failure.status === 429) {
      const now = Date.now();
      if (now - lastRateLimitAlertAt > 10_000) {
        lastRateLimitAlertAt = now;
        if (typeof window !== "undefined") {
          window.alert("Too many requests. Please wait a few seconds and try again.");
        }
      }
    }

    if (failure.status >= 500 || failure.status === 0) {
      Sentry.captureException(error, {
        extra: {
          status: failure.status,
          path,
          correlationId: failure.correlationId,
        },
      });
    }

    return Promise.reject(error);
  }
);
