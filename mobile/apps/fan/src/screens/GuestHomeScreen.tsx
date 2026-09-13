import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Headphones, RefreshCw } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import AppHeader from '../components/AppHeader';
import HeroCarousel from '../components/HeroCarousel';
import SectionHeader from '../components/SectionHeader';
import ArtistCard from '../components/ArtistCard';
import MusicCard from '../components/MusicCard';
import ExclusivePromoCard from '../components/ExclusivePromoCard';
import LockedContentCard from '../components/LockedContentCard';
import VideoCard from '../components/VideoCard';
import BenefitCard from '../components/BenefitCard';
import BottomNavigation from '../components/BottomNavigation';
import PrimaryButton from '../components/PrimaryButton';
import SecondaryButton from '../components/SecondaryButton';

import { colors } from '../theme-guest/colors';
import { spacing } from '../theme-guest/spacing';
import { radius } from '../theme-guest/radius';
import { typography } from '../theme-guest/typography';

import { benefits } from '../data/guestHome.static';
// Live catalog discovery via backend contentApi
import {
  loadGuestHomeData,
  type GuestHomeData,
} from '../services/guestHomeService';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'GuestHome'>;

const EMPTY_GUEST_DATA: GuestHomeData = {
  artists: [],
  tracks: [],
  locked: [],
  videos: [],
};

export default function GuestHomeScreen({ navigation }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const [catalog, setCatalog] = useState<GuestHomeData>(EMPTY_GUEST_DATA);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    StatusBar.setBarStyle('light-content');
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const next = await loadGuestHomeData();
      setCatalog(next);
    } catch {
      setCatalog(EMPTY_GUEST_DATA);
      setCatalogError('Live music discovery is temporarily unavailable.');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const handleGuestAction = () => {
    navigation.navigate('Login');
  };

  const handleHomePress = () => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  };

  const hasLiveCatalog =
    catalog.artists.length > 0 ||
    catalog.tracks.length > 0 ||
    catalog.locked.length > 0 ||
    catalog.videos.length > 0;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[colors.background, '#0A0A10', colors.background]}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <AppHeader onAction={handleGuestAction} />

        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Marketing hero is intentionally static; catalog sections below are live. */}
            <HeroCarousel onAction={handleGuestAction} />

            {loadingCatalog ? (
              <View style={styles.catalogState}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={styles.catalogStateTitle}>Loading live releases…</Text>
                <Text style={styles.catalogStateBody}>
                  Fetching approved artists and content from MusicWave.
                </Text>
              </View>
            ) : catalogError ? (
              <View style={styles.catalogState}>
                <Text style={styles.catalogStateTitle}>Unable to load music right now</Text>
                <Text style={styles.catalogStateBody}>{catalogError}</Text>
                <Pressable style={styles.retryButton} onPress={() => void loadCatalog()}>
                  <RefreshCw color="#FFFFFF" size={16} />
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            ) : !hasLiveCatalog ? (
              <View style={styles.catalogState}>
                <Text style={styles.catalogStateTitle}>New releases are coming soon</Text>
                <Text style={styles.catalogStateBody}>
                  There is no approved public catalog to show yet. Create an account to be ready when artists publish.
                </Text>
              </View>
            ) : (
              <>
                {catalog.artists.length > 0 ? (
                  <>
                    <SectionHeader title="Featured Artists" onAction={handleGuestAction} />
                    <FlatList
                      data={catalog.artists}
                      renderItem={({ item }) => (
                        <ArtistCard artist={item} onAction={handleGuestAction} />
                      )}
                      keyExtractor={(item) => item.id}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalList}
                    />
                  </>
                ) : null}

                {catalog.tracks.length > 0 ? (
                  <>
                    <SectionHeader title="Latest Audio" onAction={handleGuestAction} />
                    <FlatList
                      data={catalog.tracks}
                      renderItem={({ item }) => (
                        <MusicCard track={item} onAction={handleGuestAction} />
                      )}
                      keyExtractor={(item) => item.id}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalList}
                    />
                  </>
                ) : null}

                {catalog.locked.length > 0 ? (
                  <>
                    <SectionHeader title="Exclusive Early Access" onAction={handleGuestAction} />
                    <ExclusivePromoCard onAction={handleGuestAction} />
                    <FlatList
                      data={catalog.locked}
                      renderItem={({ item }) => (
                        <LockedContentCard content={item} onAction={handleGuestAction} />
                      )}
                      keyExtractor={(item) => item.id}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalList}
                    />
                  </>
                ) : null}

                {catalog.videos.length > 0 ? (
                  <>
                    <SectionHeader title="Latest Music Videos" onAction={handleGuestAction} />
                    <FlatList
                      data={catalog.videos}
                      renderItem={({ item }) => (
                        <VideoCard video={item} onAction={handleGuestAction} />
                      )}
                      keyExtractor={(item) => item.id}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalList}
                    />
                  </>
                ) : null}
              </>
            )}

            <Text style={styles.benefitsTitle}>Why Join MusicWave?</Text>
            <View style={styles.benefitsGrid}>
              {benefits.map((item) => (
                <BenefitCard
                  key={item.id}
                  benefit={item}
                  onAction={handleGuestAction}
                />
              ))}
            </View>

            <View style={styles.finalCtaContainer}>
              <LinearGradient
                colors={colors.darkGlassGradient}
                style={styles.finalCtaInner}
              >
                <View style={styles.finalCtaTopRow}>
                  <View style={styles.ctaIconContainer}>
                    <Headphones color={colors.primary} size={30} />
                  </View>
                  <Text style={styles.finalCtaTitle}>Your music journey starts here.</Text>
                </View>

                <View style={styles.finalCtaBottomRow}>
                  <PrimaryButton
                    title="Create Account"
                    onPress={handleGuestAction}
                    style={styles.ctaBtnPrimary}
                  />
                  <SecondaryButton
                    title="Sign In"
                    onPress={handleGuestAction}
                    style={styles.ctaBtnSecondary}
                  />
                  <View style={styles.ctaAlreadyAccountCol}>
                    <Text style={styles.alreadyAccountText}>Already have</Text>
                    <Text style={styles.alreadyAccountText}>an account?</Text>
                  </View>
                </View>
              </LinearGradient>
            </View>

            <View style={styles.bottomSpacer} />
          </ScrollView>
        </Animated.View>

        <BottomNavigation onAction={handleGuestAction} onHomePress={handleHomePress} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  horizontalList: {
    paddingLeft: spacing.horizontalPadding,
    paddingRight: spacing.horizontalPadding - spacing.cardGap,
    marginBottom: spacing.sectionSpacing,
  },
  catalogState: {
    marginHorizontal: spacing.horizontalPadding,
    marginTop: spacing.sectionSpacing,
    marginBottom: spacing.sectionSpacing,
    minHeight: 150,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderThin,
    backgroundColor: colors.backgroundCard,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catalogStateTitle: {
    color: colors.textPrimary,
    fontSize: typography.cardTitle + 1,
    fontWeight: typography.weightBold,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  catalogStateBody: {
    color: colors.textSecondary,
    fontSize: typography.metadata,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  retryButton: {
    marginTop: spacing.md,
    minHeight: 42,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: typography.metadata + 1,
    fontWeight: typography.weightBold,
  },
  benefitsTitle: {
    color: colors.textPrimary,
    fontSize: typography.sectionHeading,
    fontWeight: typography.weightBold,
    marginHorizontal: spacing.horizontalPadding,
    marginTop: spacing.sectionSpacing,
    marginBottom: spacing.md,
  },
  benefitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.horizontalPadding - spacing.xs,
    marginBottom: spacing.sectionSpacing,
  },
  finalCtaContainer: {
    marginHorizontal: spacing.horizontalPadding,
    marginTop: spacing.md,
    marginBottom: spacing.sectionSpacing,
  },
  finalCtaInner: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderThin,
  },
  finalCtaTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  ctaIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.15)',
  },
  finalCtaTitle: {
    color: colors.textPrimary,
    fontSize: typography.sectionHeading - 2,
    fontWeight: typography.weightBold,
    flex: 1,
  },
  finalCtaBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
  },
  ctaBtnPrimary: {
    flex: 1.2,
  },
  ctaBtnSecondary: {
    flex: 1,
  },
  ctaAlreadyAccountCol: {
    justifyContent: 'center',
    paddingLeft: 4,
  },
  alreadyAccountText: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 11,
  },
  bottomSpacer: {
    height: 20,
  },
});
