import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { AxiosHeaders } from 'axios';
import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import { API_HOST_BASE_URL } from '../config/env';

export const API_BASE_URL = `${API_HOST_BASE_URL}/api/v1/fan`;
export const JWT_STORAGE_KEY = 'jwt';
export const USER_TOKEN_STORAGE_KEY = 'userToken';
export const DEVICE_ID_STORAGE_KEY = 'fanDeviceId';

const DEFAULT_TIMEOUT_MS = 30000;
let unauthorizedHandler: (() => void | Promise<void>) | null = null;

export function setUnauthorizedHandler(handler: (() => void | Promise<void>) | null) {
  unauthorizedHandler = handler;
}

async function getOrCreateDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;

  const generated = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
  return generated;
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: DEFAULT_TIMEOUT_MS,
});

export const apiV1 = axios.create({
  baseURL: `${API_HOST_BASE_URL}/api/v1/fan`,
  headers: { 'Content-Type': 'application/json' },
  timeout: DEFAULT_TIMEOUT_MS,
});

export const contentApi = axios.create({
  baseURL: `${API_HOST_BASE_URL}/api/v1/content`,
  headers: { 'Content-Type': 'application/json' },
  timeout: DEFAULT_TIMEOUT_MS,
});

export const searchApi = axios.create({
  baseURL: `${API_HOST_BASE_URL}/api/v1/search`,
  headers: { 'Content-Type': 'application/json' },
  timeout: DEFAULT_TIMEOUT_MS,
});

const clients = [api, apiV1, contentApi, searchApi];

for (const client of clients) {
  client.interceptors.request.use(async (config) => {
    const token =
      (await AsyncStorage.getItem(USER_TOKEN_STORAGE_KEY)) ??
      (await AsyncStorage.getItem(JWT_STORAGE_KEY));
    const deviceId = await getOrCreateDeviceId();

    const headers =
      config.headers instanceof AxiosHeaders
        ? config.headers
        : new AxiosHeaders(config.headers);

    if (Platform.OS === 'web') {
      const url = String(config.url || '');
      const needsDeviceBody =
        url.includes('/auth/login') || url.includes('/user/update-password');
      if (needsDeviceBody && config.data && typeof config.data === 'object') {
        config.data = { ...config.data, deviceId };
      }
    } else {
      headers.set('X-Device-Id', deviceId);
    }

    if (token) headers.set('Authorization', `Bearer ${token}`);
    config.headers = headers;
    return config;
  });

  client.interceptors.response.use(
    async (res) => {
      // Security-sensitive operations may rotate the backend session. Persist
      // the replacement token before the next API call so pre-rotation tokens
      // are never reused by the client.
      const rotatedToken = res.data?.sessionRotated ? res.data?.token : null;
      if (typeof rotatedToken === 'string' && rotatedToken.length > 0) {
        await AsyncStorage.setItem(USER_TOKEN_STORAGE_KEY, rotatedToken);
        await AsyncStorage.removeItem(JWT_STORAGE_KEY);
      }
      return res;
    },
    async (error) => {
      const config = error?.config as (typeof error.config & { __retryCount?: number }) | undefined;
      const status = error?.response?.status;

      if (status === 401) {
        await AsyncStorage.removeItem(USER_TOKEN_STORAGE_KEY);
        await AsyncStorage.removeItem(JWT_STORAGE_KEY);
        await unauthorizedHandler?.();
      }

      if (status >= 500) {
        Sentry.captureException(error, { extra: { status, url: config?.url } });
      }

      if (!config) throw error;

      const retryCount = config.__retryCount ?? 0;
      const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message ?? ''));
      const isNetwork = !error?.response;

      if ((isTimeout || isNetwork) && retryCount < 1) {
        config.__retryCount = retryCount + 1;
        config.timeout = Math.max(Number(config.timeout ?? 0) || 0, 45000);
        return client.request(config);
      }

      throw error;
    }
  );
}
