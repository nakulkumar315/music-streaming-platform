import React, {} from 'react';

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AuthoritativeArtistScreen from './AuthoritativeArtistScreen';
import ArtistSubscriptionScreen from '../screens/ArtistSubscriptionScreen';
import ContentPlayerScreen from '../screens/ContentPlayerScreen';
import HomeScreen from '../screens/HomeScreen';
import SeeAllTrendingScreen from '../screens/SeeAllTrendingScreen';
import SubscriptionFlowScreen from '../screens/SubscriptionFlowScreen';
import SeeAllSongsScreen from '../screens/SeeAllSongsScreen';
import FullPlayerScreen from '../screens/FullPlayerScreen';

import type { MediaItem } from '../media.types';

export type HomeStackParamList = {
  HomeIndex: undefined;
  SeeAllSongs: undefined;
  SeeAllTrending: {
    artists?: any[];
  };
  Artist: {
    artistId?: string;
    contentId?: string;
  };
  SubscriptionFlow: {
    artistId?: string;
    artistName?: string;
    contentId?: string;
    artwork?: string;
    defaultPlan?: 'ARTIST' | 'PLATFORM';
  };
  ContentPlayer: {
    contentId?: string;
  };
  ArtistSubscription: {
    song?: {
      id: string;
      title: string;
      artist: string;
      duration: string;
      thumbnail: string;
      locked: boolean;
    };
    coverImage?: string;
  };
  FullPlayer: {
    songId: string;
    title: string;
    artist: string;
    imageUrl: string;
    audioUrl: string;
    queueIndex: number;
    queue: MediaItem[];
  };
};

const Stack = createNativeStackNavigator<HomeStackParamList>();

export default function HomeStackNavigator() {
  return (
    <Stack.Navigator id="fan-home" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeIndex" component={HomeScreen} />
      <Stack.Screen
        name="SeeAllSongs"
        component={SeeAllSongsScreen}
        options={{ headerShown: true, title: 'See All' }}
      />
      <Stack.Screen
        name="SeeAllTrending"
        component={SeeAllTrendingScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="Artist"
        component={AuthoritativeArtistScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen name="ArtistSubscription" component={ArtistSubscriptionScreen} />
      <Stack.Screen name="ContentPlayer" component={ContentPlayerScreen} />
      <Stack.Screen name="SubscriptionFlow" component={SubscriptionFlowScreen} />
      <Stack.Screen
        name="FullPlayer"
        component={FullPlayerScreen}
        options={{ animation: 'slide_from_bottom', gestureEnabled: true }}
      />
    </Stack.Navigator>
  );
}
