import axios, { AxiosHeaders } from "axios";
import * as Sentry from "@sentry/react";
import { artistRuntimeConfig } from "../config/runtime";
import { clearArtistSession, getArtistToken, setArtistToken } from "./artistSession";

const ARTIST_DEVICE_ID_KEY = "artistDeviceId";

export type ApiFailure = {
  status: number;
  code: string | null;
  message: string;
  correlationId: string | null;
};

function getOrCreateDeviceId() {
  const existing = localStorage.getItem(ARTIST_DEVICE_ID_KEY);
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `artist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(ARTIST_DEVICE_ID_KEY, generated);
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
    correlationId: typeof body?.correlationId === "string" ? body.correlationId : null,
  };
}

export const http = axios.create({
  baseURL: artistRuntimeConfig.apiBaseUrl,
  timeout: 15_000,
});

http.interceptors.request.use((config) => {
  const path = requestPath(config.url);
  const isLogin = path.includes("/api/v1/auth/login");
  const needsDeviceIdentity =
    isLogin ||
    path.includes("/api/v1/artist/onboard") ||
    path.includes("/api/v1/artist/update-password");

  if (needsDeviceIdentity && config.data && typeof config.data === "object") {
    config.data = { ...config.data, deviceId: getOrCreateDeviceId() };
  }

  if (!isLogin) {
    const token = getArtistToken();
    if (token) {
      const headers = AxiosHeaders.from(config.headers);
      headers.set("Authorization", `Bearer ${token}`);
      config.headers = headers;
    }
  }
  return config;
});

/** Store server-issued credentials at the HTTP boundary and remove them from
 * the response object before page components can accidentally persist/log them. */
function consumeResponseToken(
  res: { data?: Record<string, unknown> },
  token: unknown
) {
  if (typeof token !== "string" || !token.trim()) return;
  setArtistToken(token);
  if (res.data) delete res.data.token;
}

http.interceptors.response.use(
  (res) => {
    const path = requestPath(res.config?.url);
    if (res.data?.sessionRotated) {
      consumeResponseToken(res, res.data?.token);
    }

    if (path.includes("/api/v1/auth/login")) {
      const role = String(res.data?.user?.role || "").toUpperCase();
      const status = String(res.data?.user?.status || "").toUpperCase();
      if (role === "ARTIST" && status === "ACTIVE") {
        consumeResponseToken(res, res.data?.token);
      } else if (role && role !== "ARTIST") {
        clearArtistSession();
      }
    }

    if (path.includes("/api/v1/artist/onboard")) {
      consumeResponseToken(res, res.data?.token);
    }
    return res;
  },
  (error) => {
    const failure = toApiFailure(error);
    const path = requestPath(axios.isAxiosError(error) ? error.config?.url : "");

    if (failure.status === 401 || (failure.status === 403 && failure.code === "ACCOUNT_INACTIVE")) {
      clearArtistSession();
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
