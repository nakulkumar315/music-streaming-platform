import React, {} from 'react';

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AuthoritativeArtistScreen from './AuthoritativeArtistScreen';
import ArtistSubscriptionScreen from '../screens/ArtistSubscriptionScreen';
import AudioScreen from '../screens/AudioScreen';
import ContentPlayerScreen from '../screens/ContentPlayerScreen';
import FullPlayerScreen from '../screens/FullPlayerScreen';
import SubscriptionFlowScreen from '../screens/SubscriptionFlowScreen';
import AlbumDetailScreen from '../screens/AlbumDetailScreen';

import type { MediaItem } from '../media.types';

export type AudioStackParamList = {
  AudioIndex: undefined;
  Artist: {
    artistId?: string;
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
  ContentPlayer: {
    contentId?: string;
  };
  SubscriptionFlow: {
    artistId?: string;
    artistName?: string;
    contentId?: string;
    artwork?: string;
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
  AlbumDetail: {
    albumId: string;
    title: string;
    artistName: string;
    coverImage: string;
    tracks: any[];
  };
};

const Stack = createNativeStackNavigator<AudioStackParamList>();

export default function AudioStackNavigator() {
  return (
    <Stack.Navigator id="fan-audio" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AudioIndex" component={AudioScreen} />
      <Stack.Screen name="Artist" component={AuthoritativeArtistScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="ArtistSubscription" component={ArtistSubscriptionScreen} />
      <Stack.Screen name="ContentPlayer" component={ContentPlayerScreen} />
      <Stack.Screen name="SubscriptionFlow" component={SubscriptionFlowScreen} />
      <Stack.Screen
        name="FullPlayer"
        component={FullPlayerScreen}
        options={{ animation: 'slide_from_bottom', gestureEnabled: true }}
      />
      <Stack.Screen
        name="AlbumDetail"
        component={AlbumDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
}
