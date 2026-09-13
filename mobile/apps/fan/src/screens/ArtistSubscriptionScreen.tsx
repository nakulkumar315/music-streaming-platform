import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
  Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Lock } from 'lucide-react-native';
import ErrorBoundary from '../ui/ErrorBoundary';
import { apiV1 } from '../services/api';

type LockedSong = {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  thumbnail: string;
  locked: boolean;
  reason?: string;
};

export default function ArtistSubscriptionScreen({ navigation, route }: any) {
  const [songData, setSongData] = useState<LockedSong | null>(null);
  const [accessStatus, setAccessStatus] = useState<string>('NO_SUBSCRIPTION');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const paramSong = route?.params?.song;
      const paramArtistId = route?.params?.artistId ?? paramSong?.artistId ?? '';

      if (paramSong) {
        setSongData({
          id: String(paramSong.id ?? ''),
          title: paramSong.title ?? 'Exclusive Track',
          artist: paramSong.artist ?? 'Artist',
          artistId: String(paramArtistId),
          thumbnail:
            paramSong.thumbnail ??
            'https://images.unsplash.com/photo-1464863979621-258859e62245?auto=format&fit=crop&w=1400&q=80',
          locked: true,
        });
      } else {
        setSongData({
          id: 'locked-default',
          title: 'Exclusive Content',
          artist: route?.params?.artistName ?? 'Artist',
          artistId: String(paramArtistId),
          thumbnail:
            route?.params?.artwork ??
            'https://images.unsplash.com/photo-1464863979621-258859e62245?auto=format&fit=crop&w=1400&q=80',
          locked: true,
        });
      }

      // The backend derives the artist from contentId. The client never supplies
      // a second artist identifier as entitlement authority.
      if (paramArtistId) {
        try {
          const contentId = paramSong?.id;
          if (contentId) {
            const res = await apiV1.get('/subscriptions/access-check', {
              params: { contentId },
            });
            setAccessStatus(res.data?.reason ?? 'NO_SUBSCRIPTION');
          } else {
            const res = await apiV1.get('/subscriptions/me', {
              params: { artistId: paramArtistId },
            });
            const status = (res.data?.subscription?.status ?? '').toUpperCase();
            setAccessStatus(
              status === 'ACTIVE' ? 'ACTIVE' :
              status === 'GRACE' ? 'GRACE' :
              status === 'EXPIRED' || status === 'CANCELLED' ? 'EXPIRED' :
              'NO_SUBSCRIPTION'
            );
          }
        } catch {
          setAccessStatus('NO_SUBSCRIPTION');
        }
      }

      setLoading(false);
    };

    void init();
  }, [route?.params]);

  const handleSubscribe = () => {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Mobile checkout required',
        'This Phase-1 Razorpay checkout is available in the Android and iOS app.'
      );
      return;
    }

    navigation.navigate('SubscriptionFlow', {
      artistId: songData?.artistId ?? '',
      artistName: songData?.artist ?? 'Artist',
      contentId: songData?.id,
      artwork: songData?.thumbnail,
    });
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#FF7A18" size="large" />
      </View>
    );
  }

  if (!songData) return <View style={styles.container} />;

  const isExpired = accessStatus === 'EXPIRED';
  const lockBody = isExpired
    ? `Renew your subscription to ${songData.artist} to access this exclusive content.`
    : `This content is available only for ${songData.artist} subscribers.`;
  const btnLabel = isExpired ? 'Renew Subscription' : 'Subscribe to Artist';

  return (
    <ErrorBoundary label="Payments: Artist Subscription">
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.heroWrap}>
          <Image source={{ uri: songData.thumbnail }} style={styles.heroImg} />
          <LinearGradient
            colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.95)']}
            style={styles.heroGradient}
          />
        </View>

        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
        >
          <ArrowLeft color="#fff" size={24} />
        </Pressable>

        <View style={styles.centerContent}>
          <View style={styles.heroTextWrap}>
            <Text style={styles.songTitle}>{songData.title}</Text>
            <Text style={styles.songArtist}>{songData.artist}</Text>
          </View>

          <View style={styles.cardOuter}>
            <BlurView intensity={40} tint="dark" style={styles.card}>
              <View style={styles.lockedHeaderRow}>
                <Lock color="#FF6A00" size={20} />
                <Text style={styles.lockedHeaderText}>
                  {isExpired ? 'EXPIRED' : 'LOCKED EARLY ACCESS'}
                </Text>
              </View>

              <View style={styles.divider} />

              <Text style={styles.lockBody}>{lockBody}</Text>

              <View style={styles.benefitsWrap}>
                {['Early access to new releases', 'Exclusive songs & content', 'Directly support the artist'].map((b, i) => (
                  <View key={i} style={styles.benefitRow}>
                    <Text style={styles.tick}>✓</Text>
                    <Text style={styles.benefitText}>{b}</Text>
                  </View>
                ))}
              </View>

              <Pressable style={styles.subscribeBtnWrap} onPress={handleSubscribe}>
                <LinearGradient
                  colors={['#FF7A18', '#FF3D00']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.subscribeBtn}
                >
                  <Text style={styles.subscribeBtnText}>{btnLabel}</Text>
                </LinearGradient>
              </Pressable>

              <Text style={styles.secureNote}>
                {Platform.OS === 'web'
                  ? 'Checkout is completed in the mobile app'
                  : '🔒 Secure payment via Razorpay · access after server confirmation'}
              </Text>
            </BlurView>
          </View>
        </View>
      </SafeAreaView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  heroWrap: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  heroImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  heroGradient: { ...StyleSheet.absoluteFillObject },

  centerContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    zIndex: 2,
  },

  backBtn: {
    position: 'absolute',
    top: 50,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 10,
  },

  heroTextWrap: { alignItems: 'center', marginBottom: 28 },
  songTitle: {
    color: '#fff', fontSize: 30, fontWeight: '900', textAlign: 'center',
  },
  songArtist: {
    color: 'rgba(255,255,255,0.7)', fontSize: 17, fontWeight: '600', marginTop: 5,
  },

  cardOuter: { width: '100%' },
  card: {
    borderRadius: 24, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(20,20,20,0.7)', padding: 22,
  },
  lockedHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  lockedHeaderText: {
    marginLeft: 10, color: '#FF6A00', fontSize: 13, fontWeight: '900', letterSpacing: 1,
  },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 16 },
  lockBody: {
    color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600',
    textAlign: 'center', lineHeight: 20, marginBottom: 16,
  },

  benefitsWrap: { marginBottom: 16 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  tick: { color: '#FF7A18', fontSize: 14, fontWeight: '900', width: 20 },
  benefitText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600', flex: 1 },

  subscribeBtnWrap: { borderRadius: 14, overflow: 'hidden' },
  subscribeBtn: { height: 52, alignItems: 'center', justifyContent: 'center' },
  subscribeBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },

  secureNote: {
    color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: '700',
    textAlign: 'center', marginTop: 12,
  },
});