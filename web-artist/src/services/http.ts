import axios from "axios";
import * as Sentry from "@sentry/react";

const ARTIST_DEVICE_ID_KEY = "artistDeviceId";

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

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000",
  headers: {},
});

http.interceptors.request.use((config) => {
  const needsDeviceIdentity =
    config.url?.includes("/api/v1/auth/login") ||
    config.url?.includes("/api/v1/artist/onboard") ||
    config.url?.includes("/api/v1/artist/update-password");

  if (needsDeviceIdentity && config.data && typeof config.data === "object") {
    config.data = { ...config.data, deviceId: getOrCreateDeviceId() };
  }

  const token = localStorage.getItem("artistToken");
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (res) => {
    const rotatedToken = res.data?.sessionRotated ? res.data?.token : null;
    if (typeof rotatedToken === "string" && rotatedToken.length > 0) {
      localStorage.setItem("artistToken", rotatedToken);
    }
    return res;
  },
  (error) => {
    const status = error?.response?.status;

    // Only 401 represents an invalid/revoked session. A 403 is an authenticated
    // authorization/account-state decision and must remain visible to the UI.
    if (status === 401) {
      localStorage.removeItem("artistToken");
    }

    if (status >= 500) {
      Sentry.captureException(error, { extra: { status, url: error.config?.url } });
    }
    return Promise.reject(error);
  }
);
