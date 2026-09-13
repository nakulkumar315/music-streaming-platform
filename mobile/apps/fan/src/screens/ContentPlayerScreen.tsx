import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  ToastAndroid,
  Platform,
  Alert,
} from 'react-native';

import { LinearGradient } from 'expo-linear-gradient';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { ArrowLeft, Pause, Play } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useConnectivity } from '../providers/ConnectivityProvider';
import { apiV1 } from '../services/api';
import ErrorBoundary from '../ui/ErrorBoundary';

type Content = {
  id: string;
  title: string;
  artist: string;
  description: string;
  thumbnail: string;
  isLocked: boolean;
  artistId?: string;
  mediaType: 'audio' | 'video';
};

export default function ContentPlayerScreen({ navigation, route }: any) {
  const tabBarHeight = useBottomTabBarHeight();
  const { isConnected, isInternetReachable } = useConnectivity();

  const [currentContent, setCurrentContent] = useState<Content | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [wasPlayingBeforeOffline, setWasPlayingBeforeOffline] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekProgress, setSeekProgress] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const playerRef = useRef<AudioPlayer | null>(null);
  const sessionRef = useRef<{ sessionId: number; contentId: number } | null>(null);
  const progressOpacity = useRef(new Animated.Value(0)).current;
  const contentId = route?.params?.contentId;

  const terminateSession = async () => {
    const active = sessionRef.current;
    sessionRef.current = null;
    if (!active) return;
    await apiV1
      .post('/stream/terminate', {
        sessionId: active.sessionId,
        contentId: active.contentId,
      })
      .catch(() => undefined);
  };

  const disposePlayer = async () => {
    try {
      if (playerRef.current) {
        playerRef.current.remove();
        playerRef.current = null;
      }
    } finally {
      await terminateSession();
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setIsLoading(true);
        setMediaError(null);

        const id = String(contentId || '').trim();
        if (!id) {
          if (mounted) setCurrentContent(null);
          return;
        }

        const res = await apiV1.get(`/content/${encodeURIComponent(id)}`);
        const c = res.data?.content ?? null;
        if (!c) {
          if (mounted) setCurrentContent(null);
          return;
        }

        const next: Content = {
          id: String(c.id),
          title: String(c.title ?? 'Untitled'),
          artist: String(c.artistName ?? c.artist_name ?? 'Artist'),
          description: String(c.type ?? ''),
          thumbnail: String(c.artwork ?? c.thumbnailUrl ?? ''),
          isLocked: Boolean(c.isLocked ?? c.locked ?? false),
          artistId: c.artistId !== undefined && c.artistId !== null ? String(c.artistId) : undefined,
          mediaType: String(c.mediaType || c.type || '').toLowerCase().includes('video') ? 'video' : 'audio',
        };

        if (mounted) setCurrentContent(next);
      } catch (error: any) {
        if (mounted) {
          setCurrentContent(null);
          setMediaError(error?.response?.data?.message || 'Failed to load content');
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [contentId]);

  useEffect(() => {
    let mounted = true;
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      await disposePlayer();
      if (!currentContent) return;

      setMediaError(null);
      setIsPlaying(false);
      setPositionMs(0);
      setDurationMs(0);
      progressOpacity.setValue(0);

      if (currentContent.isLocked) {
        if (mounted) setMediaError('An active artist subscription is required to play this content.');
        return;
      }
      if (currentContent.mediaType !== 'audio') {
        if (mounted) setMediaError('Open this release in the video player.');
        return;
      }

      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'duckOthers',
        });

        const access = await apiV1.post('/stream/access', {
          contentId: Number(currentContent.id),
          kind: 'audio',
          quality: 'Auto',
        });
        const playbackUrl = String(access.data?.playbackUrl || '').trim();
        const sessionId = Number(access.data?.sessionId);
        if (!playbackUrl || !Number.isSafeInteger(sessionId) || sessionId <= 0) {
          throw new Error('Protected playback access was not issued');
        }

        sessionRef.current = {
          sessionId,
          contentId: Number(currentContent.id),
        };

        const player = createAudioPlayer({ uri: playbackUrl }, { updateInterval: 350 });
        playerRef.current = player;
        try {
          player.pause();
        } catch {
          // Player may still be loading; it remains paused by default.
        }

        progressTimer = setInterval(() => {
          if (!mounted) return;
          const active = playerRef.current;
          if (!active || !active.isLoaded) return;
          if (!isSeeking) {
            setPositionMs(Math.max(0, Math.round((active.currentTime || 0) * 1000)));
          }
          setDurationMs(Math.max(0, Math.round((active.duration || 0) * 1000)));
          setIsPlaying(Boolean(active.playing));
        }, 350);

        heartbeatTimer = setInterval(() => {
          const active = sessionRef.current;
          if (!active) return;
          void apiV1
            .post('/stream/heartbeat', {
              sessionId: active.sessionId,
              contentId: active.contentId,
            })
            .catch(() => {
              if (mounted) setMediaError('Playback authorization expired. Retry to reconnect.');
            });
        }, 45_000);
      } catch (error: any) {
        await disposePlayer();
        if (mounted) {
          const code = String(error?.response?.data?.code || '');
          setMediaError(
            code === 'MEDIA_ACCESS_DENIED' || code === 'MEDIA_NOT_READY'
              ? error?.response?.data?.message || 'This content is not available.'
              : 'Failed to prepare protected playback'
          );
        }
      }
    })();

    return () => {
      mounted = false;
      if (progressTimer) clearInterval(progressTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      void disposePlayer();
    };
  }, [currentContent, progressOpacity, isSeeking, reloadKey]);

  useEffect(() => {
    Animated.timing(progressOpacity, {
      toValue: isPlaying ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [isPlaying, progressOpacity]);

  useEffect(() => {
    const handleOfflineState = async () => {
      if (!isConnected || !isInternetReachable) {
        if (isPlaying) {
          setWasPlayingBeforeOffline(true);
          try {
            const player = playerRef.current;
            if (player && player.isLoaded && player.playing) player.pause();
          } catch {
            // Best-effort pause while the network is unavailable.
          }
        }
        const message = 'Waiting for network...';
        if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
        else Alert.alert('Offline', message);
      } else if (wasPlayingBeforeOffline) {
        setWasPlayingBeforeOffline(false);
        try {
          const player = playerRef.current;
          if (player && player.isLoaded && !player.playing) player.play();
        } catch {
          setMediaError('Playback failed after reconnecting');
        }
      }
    };

    void handleOfflineState();
  }, [isConnected, isInternetReachable, isPlaying, wasPlayingBeforeOffline]);

  const onBack = async () => {
    await disposePlayer();
    navigation.goBack();
  };

  const handlePlayPress = async () => {
    if (!currentContent || mediaError) return;
    if (!isConnected || !isInternetReachable) {
      const message = 'Cannot play while offline. Please check your connection.';
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.LONG);
      else Alert.alert('Offline', message);
      return;
    }

    try {
      const player = playerRef.current;
      if (!player || !player.isLoaded) return;
      if (player.playing) player.pause();
      else player.play();
    } catch {
      setMediaError('Playback failed');
    }
  };

  const retryMedia = () => {
    setMediaError(null);
    setReloadKey((value) => value + 1);
  };

  const formatTime = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const progress = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;
  const displayedProgress = isSeeking ? seekProgress : progress;
  const remainingMs = Math.max(0, durationMs - positionMs);

  const seekToProgress = async (nextProgress: number) => {
    const player = playerRef.current;
    if (!player || !player.isLoaded) return;
    const nextDurationMs = Math.max(0, Math.round((player.duration || 0) * 1000));
    if (!nextDurationMs) return;
    const nextMs = Math.max(0, Math.min(nextDurationMs, Math.round(nextProgress * nextDurationMs)));
    await player.seekTo(nextMs / 1000);
    setPositionMs(nextMs);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          setIsSeeking(true);
          setSeekProgress(displayedProgress);
        },
        onPanResponderMove: (_evt, gestureState) => {
          if (trackWidth <= 0) return;
          const x = Math.max(0, Math.min(trackWidth, gestureState.dx + displayedProgress * trackWidth));
          setSeekProgress(x / trackWidth);
        },
        onPanResponderRelease: async () => {
          try {
            await seekToProgress(Math.min(1, Math.max(0, seekProgress)));
          } finally {
            setIsSeeking(false);
          }
        },
        onPanResponderTerminate: () => setIsSeeking(false),
      }),
    [displayedProgress, seekProgress, trackWidth]
  );

  if (isLoading || !currentContent) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#FF6A00" />
        {mediaError ? <Text style={styles.loadError}>{mediaError}</Text> : null}
      </View>
    );
  }

  if (mediaError) {
    return (
      <ErrorBoundary label="Media Player">
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={[styles.loading, { backgroundColor: '#4b1927' }]}>
            <Text style={{ color: '#e6d6d2', fontSize: 16, fontWeight: '600' }}>Unable to play</Text>
            <Text style={{ color: '#d8c7c3', fontSize: 13, marginTop: 6, textAlign: 'center' }}>{mediaError}</Text>
            <Pressable onPress={retryMedia} style={styles.retryButton}>
              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Retry</Text>
            </Pressable>
            <Pressable onPress={onBack} style={[styles.retryButton, { marginTop: 8 }]}>
              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Back</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary label="Media Player">
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.container}>
          <Image source={{ uri: currentContent.thumbnail }} style={styles.bgImg} blurRadius={32} />
          <LinearGradient
            colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.92)']}
            style={styles.bgGradient}
          />

          <Pressable onPress={onBack} style={styles.backBtn}>
            <ArrowLeft color="#fff" size={22} />
          </Pressable>

          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>{currentContent.title}</Text>
            <Text style={styles.artist}>{currentContent.artist}</Text>
          </View>

          <View style={styles.centerWrap}>
            <Pressable onPress={handlePlayPress} style={styles.playOuter}>
              <LinearGradient
                colors={['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.02)']}
                style={styles.playOuterGrad}
              >
                <View style={styles.playInner}>
                  {isPlaying ? (
                    <Pause color="#fff" fill="#fff" size={30} />
                  ) : (
                    <Play color="#fff" fill="#fff" size={30} />
                  )}
                </View>
              </LinearGradient>
            </Pressable>
            <Text style={styles.description}>{currentContent.description}</Text>
          </View>

          <Animated.View style={[styles.progressWrap, { opacity: progressOpacity, bottom: tabBarHeight + 92 }]}>
            <View style={styles.progressRow}>
              <Text style={styles.progressTime}>{formatTime(positionMs)}</Text>
              <Pressable
                style={styles.progressTrack}
                onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
                onPress={async (e) => {
                  if (trackWidth <= 0) return;
                  await seekToProgress(Math.min(1, Math.max(0, e.nativeEvent.locationX / trackWidth)));
                }}
              >
                <View style={[styles.progressFill, { width: `${displayedProgress * 100}%` }]} />
                <View
                  style={[styles.progressDot, { left: `${displayedProgress * 100}%` }]}
                  {...panResponder.panHandlers}
                />
              </Pressable>
              <Text style={styles.progressTime}>-{formatTime(remainingMs)}</Text>
            </View>
          </Animated.View>
        </View>
      </SafeAreaView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadError: {
    color: 'rgba(255,255,255,0.7)',
    marginTop: 12,
    textAlign: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  bgImg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  bgGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  backBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  headerTextWrap: {
    position: 'absolute',
    top: 140,
    left: 22,
    right: 22,
    alignItems: 'flex-start',
  },
  title: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  artist: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    fontWeight: '600',
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  playOuter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    overflow: 'hidden',
  },
  playOuterGrad: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 2,
    borderColor: 'rgba(255,122,24,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    marginTop: 26,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  progressWrap: {
    position: 'absolute',
    left: 22,
    right: 22,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressTime: {
    width: 44,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginHorizontal: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FF7A18',
  },
  progressDot: {
    position: 'absolute',
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF7A18',
    marginLeft: -6,
  },
  retryButton: {
    marginTop: 14,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
