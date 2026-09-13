import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { AxiosHeaders, type AxiosError, type AxiosInstance } from 'axios';
import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import { API_HOST_BASE_URL } from '../config/env';

export const API_BASE_URL = `${API_HOST_BASE_URL}/api/v1/fan`;
export const JWT_STORAGE_KEY = 'jwt';
export const USER_TOKEN_STORAGE_KEY = 'userToken';
export const DEVICE_ID_STORAGE_KEY = 'fanDeviceId';

const DEFAULT_TIMEOUT_MS = 30000;
const SAFE_RETRY_METHODS = new Set(['get', 'head', 'options']);
let unauthorizedHandler: (() => void | Promise<void>) | null = null;

export type NormalizedApiError = {
  status: number | null;
  code: string;
  message: string;
  retryable: boolean;
};

export function setUnauthorizedHandler(handler: (() => void | Promise<void>) | null) {
  unauthorizedHandler = handler;
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  const axiosError = error as AxiosError<any>;
  const status = typeof axiosError?.response?.status === 'number' ? axiosError.response.status : null;
  const code = String(
    axiosError?.response?.data?.code ||
      (status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED')
  );
  const message = String(
    axiosError?.response?.data?.message ||
      (status === 401
        ? 'Your session has expired. Please sign in again.'
        : status === 403
          ? 'This action is not allowed for your account.'
          : 'Something went wrong. Please try again.')
  );
  const isTimeout = axiosError?.code === 'ECONNABORTED' || /timeout/i.test(String(axiosError?.message ?? ''));
  const retryable = isTimeout || !axiosError?.response;
  return { status, code, message, retryable };
}

async function getOrCreateDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;

  const generated = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
  return generated;
}

async function getStoredToken() {
  return (
    (await AsyncStorage.getItem(USER_TOKEN_STORAGE_KEY)) ??
    (await AsyncStorage.getItem(JWT_STORAGE_KEY))
  );
}

function isSafeRetry(config: any): boolean {
  const method = String(config?.method || 'get').toLowerCase();
  return SAFE_RETRY_METHODS.has(method);
}

function attachClientPolicy(client: AxiosInstance) {
  client.interceptors.request.use(async (config) => {
    const token = await getStoredToken();
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
        Sentry.captureException(error, {
          extra: {
            status,
            method: String(config?.method || '').toUpperCase(),
            path: config?.url,
          },
        });
      }

      if (!config) throw error;

      const retryCount = config.__retryCount ?? 0;
      const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message ?? ''));
      const isNetwork = !error?.response;

      // Retry only safe reads. POST/PATCH/DELETE requests may have reached the
      // backend even when the client timed out; blindly replaying them can
      // duplicate payments, sessions, reactions or other business commands.
      if (isSafeRetry(config) && (isTimeout || isNetwork) && retryCount < 1) {
        config.__retryCount = retryCount + 1;
        config.timeout = Math.max(Number(config.timeout ?? 0) || 0, 45000);
        return client.request(config);
      }

      throw error;
    }
  );

  return client;
}

function createClient(baseURL: string) {
  return attachClientPolicy(
    axios.create({
      baseURL,
      headers: { 'Content-Type': 'application/json' },
      timeout: DEFAULT_TIMEOUT_MS,
    })
  );
}

export const api = createClient(API_BASE_URL);
// Historical alias retained only at the import surface; there is one underlying
// fan Axios instance/interceptor stack.
export const apiV1 = api;
export const contentApi = createClient(`${API_HOST_BASE_URL}/api/v1/content`);
export const searchApi = createClient(`${API_HOST_BASE_URL}/api/v1/search`);
