import React, {} from 'react';

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AuthoritativeArtistScreen from './AuthoritativeArtistScreen';
import ArtistSubscriptionScreen from '../screens/ArtistSubscriptionScreen';
import ContentPlayerScreen from '../screens/ContentPlayerScreen';
import SubscriptionFlowScreen from '../screens/SubscriptionFlowScreen';
import VideoScreen from '../screens/VideoScreen';

export type VideoStackParamList = {
  VideoIndex: undefined;
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
};

const Stack = createNativeStackNavigator<VideoStackParamList>();

export default function VideoStackNavigator() {
  return (
    <Stack.Navigator id="fan-video" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="VideoIndex" component={VideoScreen} />
      <Stack.Screen name="Artist" component={AuthoritativeArtistScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="ArtistSubscription" component={ArtistSubscriptionScreen} />
      <Stack.Screen name="ContentPlayer" component={ContentPlayerScreen} />
      <Stack.Screen name="SubscriptionFlow" component={SubscriptionFlowScreen} />
    </Stack.Navigator>
  );
}
