import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Play } from 'lucide-react-native';
import ImageFallback from './ImageFallback';
import { colors } from '../theme-guest/colors';
import { spacing } from '../theme-guest/spacing';
import { radius } from '../theme-guest/radius';
import { typography } from '../theme-guest/typography';

interface VideoCardProps {
  video: {
    title: string;
    artistName: string;
    thumbnail: any;
    duration?: string;
    viewCount: string;
  };
  onAction: () => void;
}

export default function VideoCard({ video, onAction }: VideoCardProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.timing(scale, {
      toValue: 0.97,
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

  return (
    <Pressable
      onPress={onAction}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.pressable}
    >
      <Animated.View style={[styles.container, { transform: [{ scale }] }]}>
        <View style={styles.thumbnailContainer}>
          <ImageFallback
            source={video.thumbnail}
            style={styles.thumbnail}
            resizeMode="cover"
          />
          <View style={styles.playOverlay}>
            <View style={styles.playCircle}>
              <Play color="#FFFFFF" size={16} fill="#FFFFFF" />
            </View>
          </View>
          {video.duration ? (
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>{video.duration}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.infoContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {video.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {video.artistName}
          </Text>
          <Text style={styles.views}>{video.viewCount}</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginRight: spacing.cardGap,
    width: 220,
  },
  container: {
    width: '100%',
    backgroundColor: colors.backgroundCard,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderThin,
  },
  thumbnailContainer: {
    width: '100%',
    height: 124,
    position: 'relative',
    backgroundColor: '#1E1E26',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  durationText: {
    color: colors.textPrimary,
    fontSize: 10,
    fontWeight: typography.weightMedium,
  },
  infoContainer: {
    padding: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.cardTitle,
    fontWeight: typography.weightBold,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: typography.metadata,
    fontWeight: typography.weightMedium,
    marginTop: 2,
  },
  views: {
    color: colors.textMuted,
    fontSize: typography.metadata - 1,
    marginTop: 4,
  },
});
