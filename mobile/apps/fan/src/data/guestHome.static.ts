import type { ImageSourcePropType } from 'react-native';

export type HeroSlide = {
  id: string;
  title: string;
  description: string;
  image: ImageSourcePropType;
};

export type Benefit = {
  id: string;
  title: string;
  description: string;
  iconName: string;
};

// These are explicitly marketing assets/copy, not representations of live
// artists or catalog entries. Live discovery data is fetched from the backend.
export const heroSlides: HeroSlide[] = [
  {
    id: 'hero-1',
    title: 'Feel Every Beat',
    description: 'Stream approved audio and music videos from artists on the platform.',
    image: { uri: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=800&q=80' },
  },
  {
    id: 'hero-2',
    title: 'Discover Early Releases',
    description: 'Explore public releases and subscribe to unlock artist-only content.',
    image: { uri: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=800&q=80' },
  },
  {
    id: 'hero-3',
    title: 'Support Artists Directly',
    description: 'Create an account and subscribe to the artists you want to support.',
    image: { uri: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80' },
  },
];

export const benefits: Benefit[] = [
  {
    id: 'ben-1',
    title: 'Music Streaming',
    description: 'Listen to approved releases from the live catalog.',
    iconName: 'Music',
  },
  {
    id: 'ben-2',
    title: 'Exclusive Releases',
    description: 'Unlock subscriber-only releases from artists you support.',
    iconName: 'Sparkles',
  },
  {
    id: 'ben-3',
    title: 'Support Artists',
    description: 'Subscribe directly to artists and support their work.',
    iconName: 'Heart',
  },
  {
    id: 'ben-4',
    title: 'Audio & Video',
    description: 'Enjoy audio and music videos in one app.',
    iconName: 'PlayCircle',
  },
];
