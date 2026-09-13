import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, setUnauthorizedHandler } from '../services/api';
import {
  clearAuthCredential,
  readAuthCredential,
  saveAuthCredential,
} from '../security/credentialStorage';

export type SessionUser = {
  id?: string | number;
  email?: string;
  name?: string;
  status?: AccountStatus;
} & Record<string, unknown>;

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'UNKNOWN';

const SESSION_USER_STORAGE_KEY = 'sessionUser';

type AuthContextValue = {
  token: string | null;
  user: SessionUser | null;
  isRestoring: boolean;
  isLoggingIn: boolean;
  isAuthenticated: boolean;
  userAccountStatus: AccountStatus;
  isAccountSuspended: boolean;
  bootstrapAuth: () => Promise<void>;
  restoreToken: () => Promise<string | null>;
  setToken: (token: string | null) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchSession: () => Promise<SessionUser | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function extractToken(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const candidate = record.token ?? record.jwt ?? record.accessToken ?? (record.data as any)?.token;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function extractUser(data: unknown): SessionUser | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const candidate = record.user ?? record.data ?? record.session ?? record;
  return typeof candidate === 'object' && candidate ? (candidate as SessionUser) : null;
}

function extractAccountStatus(data: unknown): AccountStatus {
  if (!data || typeof data !== 'object') return 'UNKNOWN';
  const record = data as Record<string, unknown>;
  const user = extractUser(record);
  const candidate =
    (user as any)?.status ??
    (user as any)?.account_status ??
    record.status ??
    record.account_status;

  if (candidate === 'ACTIVE' || candidate === 'SUSPENDED' || candidate === 'INACTIVE') {
    return candidate;
  }
  return 'UNKNOWN';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [userAccountStatus, setUserAccountStatusState] = useState<AccountStatus>('UNKNOWN');

  const isAccountSuspended =
    userAccountStatus === 'SUSPENDED' || userAccountStatus === 'INACTIVE';
  const isAuthenticated = Boolean(token && token.trim().length > 0 && userAccountStatus === 'ACTIVE');

  const clearLocalSession = useCallback(async () => {
    setTokenState(null);
    setUser(null);
    setUserAccountStatusState('UNKNOWN');
    await AsyncStorage.removeItem(SESSION_USER_STORAGE_KEY);

    try {
      await clearAuthCredential();
    } catch (error) {
      // Session state must remain logged out even if the OS secure-store delete
      // call fails. The next unauthorized response will attempt cleanup again.
      Sentry.captureException(error, {
        tags: { area: 'auth-storage', action: 'clear-local-session' },
      });
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => clearLocalSession());
    return () => setUnauthorizedHandler(null);
  }, [clearLocalSession]);

  const restoreToken = useCallback(async () => {
    setIsRestoring(true);
    try {
      const stored = await readAuthCredential();
      setTokenState(stored);
      return stored;
    } finally {
      setIsRestoring(false);
    }
  }, []);

  const setToken = useCallback(async (next: string | null) => {
    if (next) {
      await saveAuthCredential(next);
    } else {
      await clearAuthCredential();
    }
    setTokenState(next);
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const res = await api.get('/auth/session');
      const nextUser = extractUser(res.data);
      const status = extractAccountStatus(res.data);

      if (!nextUser || status !== 'ACTIVE') {
        await clearLocalSession();
        return null;
      }

      const mergedUser = { ...nextUser, status } as SessionUser;
      setUser(mergedUser);
      setUserAccountStatusState(status);
      await AsyncStorage.setItem(SESSION_USER_STORAGE_KEY, JSON.stringify(mergedUser));
      return mergedUser;
    } catch {
      await clearLocalSession();
      return null;
    }
  }, [clearLocalSession]);

  const bootstrapAuth = useCallback(async () => {
    setIsRestoring(true);
    try {
      const stored = await readAuthCredential();

      if (!stored) {
        await clearLocalSession();
        return;
      }

      setTokenState(stored);
      setUserAccountStatusState('UNKNOWN');
      await fetchSession();
    } catch {
      await clearLocalSession();
    } finally {
      setIsRestoring(false);
    }
  }, [clearLocalSession, fetchSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoggingIn(true);
      try {
        const res = await api.post('/auth/login', { email, password });
        const nextToken = extractToken(res.data);
        const nextUser = extractUser(res.data);
        const status = extractAccountStatus(res.data);

        if (!nextToken || !nextUser || status !== 'ACTIVE') {
          throw new Error('Authentication response is incomplete.');
        }

        await setToken(nextToken);
        const mergedUser = { ...nextUser, status } as SessionUser;
        setUser(mergedUser);
        setUserAccountStatusState(status);
        await AsyncStorage.setItem(SESSION_USER_STORAGE_KEY, JSON.stringify(mergedUser));
        await fetchSession();
      } finally {
        setIsLoggingIn(false);
      }
    },
    [fetchSession, setToken]
  );

  const logout = useCallback(async () => {
    try {
      if (token) {
        await api.post('/auth/logout');
      }
    } catch {
      // Local logout must still complete if the session was already revoked or
      // the network is unavailable.
    } finally {
      await clearLocalSession();
    }
  }, [clearLocalSession, token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isRestoring,
      isLoggingIn,
      isAuthenticated,
      userAccountStatus,
      isAccountSuspended,
      bootstrapAuth,
      restoreToken,
      setToken,
      login,
      logout,
      fetchSession,
    }),
    [
      token,
      user,
      isRestoring,
      isLoggingIn,
      isAuthenticated,
      userAccountStatus,
      isAccountSuspended,
      bootstrapAuth,
      restoreToken,
      setToken,
      login,
      logout,
      fetchSession,
    ]
  );

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}