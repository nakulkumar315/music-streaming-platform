import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Play } from 'lucide-react-native';
import ImageFallback from './ImageFallback';
import { colors } from '../theme-guest/colors';
import { spacing } from '../theme-guest/spacing';
import { radius } from '../theme-guest/radius';
import { typography } from '../theme-guest/typography';

interface MusicCardProps {
  track: {
    title: string;
    artistName: string;
    artwork: any;
    duration?: string;
    badge?: 'EARLY_ACCESS' | 'PREMIUM' | 'NEW';
  };
  onAction: () => void;
}

export default function MusicCard({ track, onAction }: MusicCardProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.timing(scale, {
      toValue: 0.96,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  const renderBadge = () => {
    if (!track.badge) return null;
    let label = '';
    let badgeBg = 'rgba(255, 255, 255, 0.15)';
    let badgeText = colors.textPrimary;

    if (track.badge === 'NEW') {
      label = 'NEW';
      badgeBg = colors.highlight;
      badgeText = '#000000';
    } else if (track.badge === 'PREMIUM') {
      label = 'PREMIUM';
      badgeBg = colors.secondary;
    } else if (track.badge === 'EARLY_ACCESS') {
      label = 'EARLY ACCESS';
      badgeBg = colors.primary;
    }

    return (
      <View style={[styles.badgeContainer, { backgroundColor: badgeBg }]}>
        <Text style={[styles.badgeText, { color: badgeText }]}>{label}</Text>
      </View>
    );
  };

  return (
    <Pressable
      onPress={onAction}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.pressable}
    >
      <Animated.View style={[styles.container, { transform: [{ scale }] }]}>
        <View style={styles.imageContainer}>
          <ImageFallback
            source={track.artwork}
            style={styles.artwork}
            resizeMode="cover"
          />
          {renderBadge()}
          <View style={styles.playOverlay}>
            <View style={styles.playCircle}>
              <Play color="#FFFFFF" size={14} fill="#FFFFFF" />
            </View>
          </View>
        </View>

        <View style={styles.infoContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {track.title}
            </Text>
            <Pressable onPress={onAction} hitSlop={10}>
              <Text style={styles.moreText}>⋮</Text>
            </Pressable>
          </View>
          <Text style={styles.artist} numberOfLines={1}>
            {track.artistName}
          </Text>
          {track.duration ? <Text style={styles.duration}>{track.duration}</Text> : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginRight: spacing.cardGap,
    width: 140,
  },
  container: {
    width: '100%',
    backgroundColor: colors.backgroundCard,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderThin,
  },
  imageContainer: {
    width: '100%',
    height: 140,
    position: 'relative',
    backgroundColor: '#1E1E26',
  },
  artwork: {
    width: '100%',
    height: '100%',
  },
  badgeContainer: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.xs,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: typography.weightBold,
    letterSpacing: 0.5,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    padding: 8,
  },
  playCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  infoContainer: {
    padding: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.cardTitle,
    fontWeight: typography.weightBold,
    flex: 1,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: typography.metadata,
    fontWeight: typography.weightMedium,
    marginTop: 2,
  },
  duration: {
    color: colors.textMuted,
    fontSize: typography.metadata - 1,
    marginTop: 4,
  },
  moreText: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },
});
