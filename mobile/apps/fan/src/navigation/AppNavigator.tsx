import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useState } from 'react';

import { Platform } from 'react-native';
import SplashScreen from '../screens/SplashScreen';
import { useAuth } from '../store/authStore';
import { navigationRef } from './rootNavigation';
import { useMediaPlayer } from '../providers/MediaPlayerProvider';
import MediaPlayerOverlay from '../ui/MediaPlayerOverlay';

import type { RootStackParamList } from './types';

import LoginScreen from '../screens/LoginScreen';
import GuestHomeScreen from '../screens/GuestHomeScreen';
import SignupScreen from '../screens/SignupScreen';
import MainTabsNavigator from './MainTabsNavigator';
import ArtistOnboardingScreen from '../screens/ArtistOnboardingScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const { isAuthenticated, bootstrapAuth } = useAuth();
  const player = useMediaPlayer();
  const [isSplashVisible, setIsSplashVisible] = React.useState(true);
  const [, setCurrentRouteName] = useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    const start = Date.now();

    (async () => {
      try {
        await bootstrapAuth();
      } finally {
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, 3000 - elapsed);
        setTimeout(() => {
          if (mounted) setIsSplashVisible(false);
        }, remaining);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [bootstrapAuth]);

  if (isSplashVisible) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={DarkTheme}
      onStateChange={() => {
        const route = navigationRef.getCurrentRoute();
        setCurrentRouteName(route?.name ?? null);
      }}
    >
      <Stack.Navigator id="fan-root">
        {isAuthenticated ? (
          <>
            <Stack.Screen
              name="MainTabs"
              component={MainTabsNavigator}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ArtistOnboarding"
              component={ArtistOnboardingScreen}
              options={{ headerShown: false, presentation: 'modal' }}
            />
          </>
        ) : (
          <>
            <Stack.Screen
              name="GuestHome"
              component={GuestHomeScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Signup"
              component={SignupScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
      <MediaPlayerOverlay
        bottomSafeAreaPadding={Platform.OS === 'web' ? 12 : 0}
        state={player.state}
        currentItem={player.currentItem}
        togglePlayPause={player.togglePlayPause}
        skipNext={player.skipNext}
        skipPrev={player.skipPrev}
        seekTo={player.seekTo}
        toggleShuffle={player.toggleShuffle}
        cycleRepeatMode={player.cycleRepeatMode}
        setPlaybackRate={player.setPlaybackRate}
        setVolume={player.setVolume}
        close={player.close}
        setExpanded={player.setExpanded}
        inlineVideoHostActive={player.inlineVideoHostActive}
        inlineAudioHostActive={player.inlineAudioHostActive}
        onVideoPlaybackStatusUpdate={player.onVideoPlaybackStatusUpdate}
        videoPlayer={player.videoPlayer}
        audioPlayer={player.audioPlayer}
      />
    </NavigationContainer>
  );
}
