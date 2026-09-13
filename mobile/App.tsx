import 'react-native-gesture-handler';

import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import AppNavigator from './apps/fan/src/navigation/AppNavigator';
import { AuthProvider } from './apps/fan/src/store/authStore';
import { ConnectivityProvider } from './apps/fan/src/providers/ConnectivityProvider';
import {
  MediaPlayerProvider,
  useMediaPlayer,
} from './apps/fan/src/providers/MediaPlayerProvider';
import { releaseActivePlaybackLease } from './apps/fan/src/services/streamService';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ErrorBoundary from './apps/fan/src/ui/ErrorBoundary';
import { applyTheme, DEFAULT_THEME_ID } from './apps/fan/src/config/themeConfig';
import { SENTRY_DSN, SENTRY_RELEASE } from './apps/fan/src/config/env';

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

/**
 * The media player intentionally keeps a lease while paused so Resume remains
 * the same playback session. When Close clears the queue/current item, release
 * that lease immediately instead of waiting for the server's stale-session TTL.
 */
function PlaybackLeaseLifecycleBridge() {
  const { currentItem } = useMediaPlayer();

  useEffect(() => {
    if (!currentItem) {
      void releaseActivePlaybackLease();
    }
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
