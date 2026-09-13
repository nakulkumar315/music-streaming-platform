import 'react-native-gesture-handler';

import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import AppNavigator from './apps/fan/src/navigation/AppNavigator';
import { AuthProvider, useAuth } from './apps/fan/src/store/authStore';
import { ConnectivityProvider } from './apps/fan/src/providers/ConnectivityProvider';
import {
  MediaPlayerProvider,
  useMediaPlayer,
} from './apps/fan/src/providers/MediaPlayerProvider';
import {
  fetchPlaybackProgress,
  resolveResumePosition,
  savePlaybackProgress,
  type PlaybackProgress,
} from './apps/fan/src/services/playbackProgressService';
import {
  startHeartbeat,
  stopHeartbeat,
} from './apps/fan/src/services/heartbeatService';
import { releaseActivePlaybackLease } from './apps/fan/src/services/streamService';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ErrorBoundary from './apps/fan/src/ui/ErrorBoundary';
import { applyTheme, DEFAULT_THEME_ID } from './apps/fan/src/config/themeConfig';
import { SENTRY_DSN, SENTRY_RELEASE } from './apps/fan/src/config/env';
import { sanitizeSentryEvent } from './apps/fan/src/utils/sentrySanitizer';

if (Platform.OS === 'web') {
  const savedTheme = localStorage.getItem('global-theme') || DEFAULT_THEME_ID;
  applyTheme(savedTheme);
}

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: SENTRY_RELEASE ?? undefined,
    debug: __DEV__,
    sendDefaultPii: false,
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

const PROGRESS_SAVE_INTERVAL_MS = 20_000;

type ProgressSnapshot = {
  key: string;
  contentId: string | number;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
};

/**
 * Persists bounded account-level resume state without ever persisting or
 * reusing a signed media URL. Playback authorization remains server-side.
 */
function PlaybackProgressLifecycleBridge() {
  const { currentItem, state, seekTo } = useMediaPlayer();
  const { isAuthenticated, isRestoring } = useAuth();
  const rawContentId = currentItem?.contentId ?? currentItem?.id ?? null;
  const contentKey = rawContentId === null ? null : String(rawContentId);

  const snapshotsRef = useRef<Map<string, ProgressSnapshot>>(new Map());
  const hydratedKeyRef = useRef<string | null>(null);
  const pendingResumeRef = useRef<{ key: string; progress: PlaybackProgress | null } | null>(null);
  const resumeAppliedKeyRef = useRef<string | null>(null);
  const previousPlayingRef = useRef(false);

  const flushSnapshot = useCallback(async (snapshot: ProgressSnapshot | null | undefined) => {
    if (!snapshot || hydratedKeyRef.current !== snapshot.key) return;
    try {
      await savePlaybackProgress({
        contentId: snapshot.contentId,
        positionMs: snapshot.positionMs,
        durationMs: snapshot.durationMs > 0 ? snapshot.durationMs : null,
      });
    } catch (error) {
      Sentry.captureException(error, {
        tags: { area: 'playback-progress', action: 'save' },
      });
    }
  }, []);

  useEffect(() => {
    if (!contentKey || rawContentId === null) return;
    snapshotsRef.current.set(contentKey, {
      key: contentKey,
      contentId: rawContentId,
      positionMs: Math.max(0, Math.floor(state.positionMs || 0)),
      durationMs: Math.max(0, Math.floor(state.durationMs || 0)),
      isPlaying: state.isPlaying,
    });
  }, [contentKey, rawContentId, state.positionMs, state.durationMs, state.isPlaying]);

  useEffect(() => {
    if (!contentKey || rawContentId === null || !isAuthenticated || isRestoring) {
      hydratedKeyRef.current = null;
      pendingResumeRef.current = null;
      resumeAppliedKeyRef.current = null;
      return;
    }

    let active = true;
    hydratedKeyRef.current = null;
    pendingResumeRef.current = null;
    resumeAppliedKeyRef.current = null;

    void fetchPlaybackProgress(rawContentId)
      .then((progress) => {
        if (!active) return;
        hydratedKeyRef.current = contentKey;
        pendingResumeRef.current = { key: contentKey, progress };
      })
      .catch((error) => {
        if (!active) return;
        // Playback itself must not fail because the optional resume lookup did.
        hydratedKeyRef.current = contentKey;
        pendingResumeRef.current = { key: contentKey, progress: null };
        Sentry.captureException(error, {
          tags: { area: 'playback-progress', action: 'load' },
        });
      });

    return () => {
      active = false;
      const snapshot = snapshotsRef.current.get(contentKey);
      if (snapshot && hydratedKeyRef.current === contentKey) {
        void flushSnapshot(snapshot);
      }
    };
  }, [contentKey, rawContentId, isAuthenticated, isRestoring, flushSnapshot]);

  useEffect(() => {
    if (!contentKey || hydratedKeyRef.current !== contentKey) return;
    if (resumeAppliedKeyRef.current === contentKey) return;

    const pending = pendingResumeRef.current;
    if (!pending || pending.key !== contentKey) return;

    // Wait until the native player has started or exposed duration so seekTo
    // cannot race an unloaded TrackPlayer/VideoPlayer instance.
    if (!state.isPlaying && state.durationMs <= 0) return;

    const itemDuration = Math.max(0, Math.floor(Number(currentItem?.duration) || 0));
    const target = resolveResumePosition(
      pending.progress,
      state.durationMs > 0 ? state.durationMs : itemDuration
    );
    resumeAppliedKeyRef.current = contentKey;
    pendingResumeRef.current = null;

    if (target > 0 && Math.abs(target - state.positionMs) > 1_000) {
      void seekTo(target).catch((error) => {
        Sentry.captureException(error, {
          tags: { area: 'playback-progress', action: 'resume-seek' },
        });
      });
    }
  }, [contentKey, currentItem?.duration, seekTo, state.durationMs, state.isPlaying, state.positionMs]);

  useEffect(() => {
    const wasPlaying = previousPlayingRef.current;
    previousPlayingRef.current = state.isPlaying;
    if (!wasPlaying || state.isPlaying || !contentKey) return;
    void flushSnapshot(snapshotsRef.current.get(contentKey));
  }, [contentKey, state.isPlaying, flushSnapshot]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => {
      if (!contentKey || hydratedKeyRef.current !== contentKey) return;
      const snapshot = snapshotsRef.current.get(contentKey);
      if (snapshot?.isPlaying) void flushSnapshot(snapshot);
    }, PROGRESS_SAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [contentKey, isAuthenticated, flushSnapshot]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (previousState === 'active' && nextState !== 'active' && contentKey) {
        void flushSnapshot(snapshotsRef.current.get(contentKey));
      }
      previousState = nextState;
    });
    return () => subscription.remove();
  }, [contentKey, flushSnapshot]);

  return null;
}

/**
 * Owns trusted heartbeat start/stop from canonical player state. This is kept
 * separate from playback-history recording so a pause/resume of the same item
 * cannot be suppressed by the UX-history de-duplication in MediaPlayerProvider.
 */
function PlaybackHeartbeatLifecycleBridge() {
  const { currentItem, state } = useMediaPlayer();
  const { isAuthenticated, isRestoring } = useAuth();
  const rawContentId = currentItem?.contentId ?? currentItem?.id ?? null;
  const contentKey = rawContentId === null ? null : String(rawContentId);
  const positionRef = useRef(0);
  const durationRef = useRef(0);

  positionRef.current = Math.max(0, Math.floor(state.positionMs || 0));
  durationRef.current = Math.max(0, Math.floor(state.durationMs || 0));

  useEffect(() => {
    if (!isAuthenticated || isRestoring || !contentKey || !state.isPlaying) {
      stopHeartbeat();
      return;
    }

    startHeartbeat(
      contentKey,
      () => positionRef.current,
      () => durationRef.current
    );

    return () => {
      stopHeartbeat();
    };
  }, [contentKey, isAuthenticated, isRestoring, state.isPlaying]);

  return null;
}

/**
 * Keeps native playback and the server playback lease aligned with player and
 * authentication lifecycle. Pause intentionally preserves the lease so Resume
 * remains the same playback session.
 */
function PlaybackLeaseLifecycleBridge() {
  const { currentItem, close } = useMediaPlayer();
  const { isAuthenticated, isRestoring } = useAuth();
  const hadAuthenticatedSessionRef = useRef(false);

  useEffect(() => {
    if (isAuthenticated) {
      hadAuthenticatedSessionRef.current = true;
      return;
    }
    if (isRestoring || !hadAuthenticatedSessionRef.current) return;

    hadAuthenticatedSessionRef.current = false;
    void close().finally(() => releaseActivePlaybackLease());
  }, [close, isAuthenticated, isRestoring]);

  useEffect(() => {
    if (!currentItem) void releaseActivePlaybackLease();
  }, [currentItem]);

  useEffect(() => {
    return () => {
      void releaseActivePlaybackLease();
    };
  }, []);

  return null;
}

export default function App() {
  useEffect(() => {
    if (Platform.OS !== 'web') {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT).catch(() => {});
    }
  }, []);

  return (
    <ErrorBoundary label="Fan App">
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AuthProvider>
            <ConnectivityProvider>
              <MediaPlayerProvider>
                <PlaybackProgressLifecycleBridge />
                <PlaybackHeartbeatLifecycleBridge />
                <PlaybackLeaseLifecycleBridge />
                <AppNavigator />
              </MediaPlayerProvider>
            </ConnectivityProvider>
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
