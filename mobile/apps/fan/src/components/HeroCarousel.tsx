import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, FlatList, Pressable, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ImageFallback from './ImageFallback';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';
import { colors } from '../theme-guest/colors';
import { spacing } from '../theme-guest/spacing';
import { radius } from '../theme-guest/radius';
import { typography } from '../theme-guest/typography';
import { heroSlides } from '../data/guestHome.static';

const { width: screenWidth } = Dimensions.get('window');
const CAROUSEL_WIDTH = screenWidth - spacing.horizontalPadding * 2;

interface HeroCarouselProps {
  onAction: () => void;
}

export default function HeroCarousel({ onAction }: HeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<any>>(null);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDragging = useRef(false);

  const startAutoScroll = () => {
    stopAutoScroll();
    autoScrollTimer.current = setInterval(() => {
      if (isDragging.current) return;
      const nextIndex = (activeIndex + 1) % heroSlides.length;
      flatListRef.current?.scrollToIndex({
        index: nextIndex,
        animated: true,
      });
      setActiveIndex(nextIndex);
    }, 5000);
  };

  const stopAutoScroll = () => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  };

  useEffect(() => {
    startAutoScroll();
    return () => stopAutoScroll();
  }, [activeIndex]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrollOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollOffset / CAROUSEL_WIDTH);
    if (index !== activeIndex && index >= 0 && index < heroSlides.length) {
      setActiveIndex(index);
    }
  };

  const getItemLayout = (_: any, index: number) => ({
    length: CAROUSEL_WIDTH,
    offset: CAROUSEL_WIDTH * index,
    index,
  });

  const renderItem = ({ item, index }: { item: typeof heroSlides[0]; index: number }) => {
    return (
      <Pressable onPress={onAction} style={styles.slideContainer}>
        <ImageFallback
          source={item.image}
          style={styles.image}
          resizeMode="cover"
        />
        <LinearGradient
          colors={colors.heroGradient}
          style={styles.gradientOverlay}
        />
        <View style={styles.contentContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>

          {index === 0 && (
            <View style={styles.buttonRow}>
              <PrimaryButton
                title="Start Listening"
                onPress={onAction}
                style={styles.primaryBtn}
                showPlayIcon={true}
              />
              <SecondaryButton
                title="Sign In"
                onPress={onAction}
                style={styles.secondaryBtn}
              />
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={heroSlides}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={CAROUSEL_WIDTH}
        decelerationRate="fast"
        getItemLayout={getItemLayout}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          isDragging.current = true;
          stopAutoScroll();
        }}
        onScrollEndDrag={() => {
          isDragging.current = false;
          startAutoScroll();
        }}
        scrollEventThrottle={16}
        style={styles.list}
      />

      <View style={styles.pagination}>
        {heroSlides.map((_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              activeIndex === index ? styles.activeDot : styles.inactiveDot,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.horizontalPadding,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderThin,
    backgroundColor: colors.backgroundCard,
    position: 'relative',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
  },
  list: {
    width: CAROUSEL_WIDTH,
    height: 320,
  },
  slideContainer: {
    width: CAROUSEL_WIDTH,
    height: 320,
    position: 'relative',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  contentContainer: {
    position: 'absolute',
    bottom: 24,
    left: spacing.lg,
    right: spacing.lg,
    maxWidth: '85%',
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.heroHeading - 4,
    fontWeight: typography.weightBold,
    marginBottom: spacing.xs,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  description: {
    color: colors.textSecondary,
    fontSize: typography.metadata + 1,
    lineHeight: 18,
    marginBottom: spacing.md,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryBtn: {
    flex: 1,
  },
  secondaryBtn: {
    flex: 1,
  },
  pagination: {
    position: 'absolute',
    bottom: 12,
    right: 20,
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  activeDot: {
    width: 16,
    backgroundColor: colors.primary,
  },
  inactiveDot: {
    width: 6,
    backgroundColor: colors.textInactive,
  },
});
