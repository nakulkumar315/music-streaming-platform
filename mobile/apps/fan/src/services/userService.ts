import { apiV1 } from './api';
import logger from '../utils/logger';

export type AudioQualityPref = 'HIGH' | 'DATA SAVER';

export type UserProfile = {
  name: string;
  fullName?: string;
  username?: string;
  bio?: string;
  favoriteGenre?: string;
  location?: string;
  isPremium: boolean;
  subscriptionCount: number;
  profileImageUrl?: string;
  pushNotifications: boolean;
  audioQuality: AudioQualityPref;
};

export type SubscriptionRecord = {
  id: string | number;
  type: 'ARTIST' | 'PLATFORM';
  status: string;
  planType: string;
  endDate: string | null;
  nextBillingDate: string | null;
  graceEndsAt: string | null;
  daysLeft: number | null;
  isExpiringSoon: boolean;
  artistId?: string | null;
  artistName?: string;
  artistAvatar?: string;
  price?: number;
  currency?: string;
  features?: string[];
  autoRenew: boolean;
};

export type SubscriptionPlanSummary = {
  status: string;
  planType: string;
  endDate: string | null;
  artistId: string | null;
  artistName?: string;
  // Extended fields
  artistPlan: SubscriptionRecord | null;
  platformPlan: SubscriptionRecord | null;
  artistSubCount: number;
};

export type Transaction = {
  id: string;
  amount: number;
  artistName: string;
  date: string;
  status?: string;
  billingCycle?: string;
};

export type ListenTime = {
  totalMinutes: number;
  formattedTime: string;
};

export type UpdateProfileInput = {
  fullName?: string;
  username?: string;
  bio?: string;
  favoriteGenre?: string;
  location?: string;
};

export type UpdatePasswordInput = {
  oldPassword?: string;
  newPassword?: string;
};

export type UpdateSettingsInput = {
  pushNotifications?: boolean;
  audioQuality?: AudioQualityPref;
};

export type AccessCheckResult = {
  allowed: boolean;
  reason: string;
  graceEndsAt?: string;
};

export type QualityResult = {
  quality: 'HD' | 'SD';
  maxResolution: string;
  isGrace?: boolean;
};

export type PlatformConfig = {
  price: number;
  yearly_price?: number;
  discount_price?: number;
  discount_months?: number;
  currency: string;
  duration: string;
  features: string[];
};

export type UpsellStatus = {
  success: boolean;
  interactionCount: number;
  showStrongUpsell: boolean;
};

export type ArtistProfile = {
  id: number;
  name: string;
  subscriptionPrice: number;
  isVerified: boolean;
  profileImageUrl?: string;
  bio?: string;
  subscriptionFeatures?: string[];
};

export interface UserService {
  getUserProfile(): Promise<UserProfile>;
  getTransactions(): Promise<Transaction[]>;
  getListenTime(): Promise<ListenTime>;
  getSubscriptionPlanSummary(): Promise<SubscriptionPlanSummary | null>;
  checkContentAccess(contentId: number, artistId: string): Promise<AccessCheckResult>;
  checkStreamingQuality(): Promise<QualityResult>;
  updateProfile(input: UpdateProfileInput): Promise<any>;
  updatePassword(input: UpdatePasswordInput): Promise<any>;
  uploadProfileImage(uri: string, mimeType: string, fileName: string): Promise<string>;
  updateSettings(input: UpdateSettingsInput): Promise<any>;
  getPlatformConfig(): Promise<PlatformConfig | null>;
  getSubscriptionDetails(): Promise<{
    platform: SubscriptionRecord | null;
    artists: SubscriptionRecord[];
    transactions: Transaction[];
  } | null>;
  getFullSubscriptionStatus(): Promise<{
    platform: SubscriptionRecord | null;
    artists: SubscriptionRecord[];
    count: number;
  } | null>;
  trackUpsellAttempt(): Promise<void>;
  getUpsellStatus(): Promise<UpsellStatus | null>;
  getArtistProfile(artistId: number): Promise<ArtistProfile | null>;
  toggleAutoRenew(subId: string | number, autoRenew: boolean): Promise<boolean>;
  cancelSubscription(subId: string | number, input: { reason: string; feedback?: string; accepted_retention_offer?: boolean }): Promise<any>;
  getInvoiceUrl(txId: string | number): string;
}

function mapSubRecord(raw: any): SubscriptionRecord | null {
  if (!raw) return null;
  return {
    id: raw.id !== undefined ? String(raw.id) : raw.artist_id !== undefined ? String(raw.artist_id) : '',
    type: (raw.type ?? 'ARTIST') as 'ARTIST' | 'PLATFORM',
    status: (raw.status ?? '').toString(),
    planType: (raw.plan_type ?? raw.planType ?? 'MONTHLY').toString(),
    endDate: raw.end_date ? String(raw.end_date) : null,
    nextBillingDate: raw.next_billing_date ? String(raw.next_billing_date) : null,
    graceEndsAt: raw.grace_ends_at ? String(raw.grace_ends_at) : null,
    daysLeft: raw.daysLeft !== undefined ? Number(raw.daysLeft) : null,
    isExpiringSoon: Boolean(raw.isExpiringSoon),
    artistId: raw.artist_id !== undefined && raw.artist_id !== null ? String(raw.artist_id) : null,
    artistName: (raw.artist_name ?? raw.artist_display_name ?? '').toString(),
    artistAvatar: raw.artist_avatar ? String(raw.artist_avatar) : undefined,
    price: raw.price || raw.subscription_price ? Number(raw.price || raw.subscription_price) : undefined,
    currency: (raw.currency ?? 'INR').toString(),
    features: Array.isArray(raw.features) ? raw.features : undefined,
    autoRenew: Boolean(raw.auto_renew ?? false),
  };
}

export const userService: UserService = {
  async getUserProfile() {
    const res = await apiV1.get('/user/profile');
    const profile = res.data?.profile ?? {};
    const premium = res.data?.premium ?? {};
    return {
      name: (profile.name || profile.fullName || profile.full_name || '').toString(),
      fullName: (profile.fullName || profile.full_name || '').toString(),
      username: (profile.username || '').toString(),
      bio: (profile.bio || '').toString(),
      favoriteGenre: (profile.favoriteGenre || profile.favorite_genre || '').toString(),
      location: (profile.location || '').toString(),
      profileImageUrl: (profile.profileImageUrl || profile.profile_image_url || '').toString(),
      isPremium: Boolean(premium.isPremium ?? false),
      subscriptionCount: Number(premium.subscriptionCount ?? 0),
      pushNotifications: Boolean(profile.notificationsPref ?? true),
      audioQuality: (profile.audioQualityPref || 'HIGH') as AudioQualityPref,
    };
  },

  async getTransactions() {
    const res = await apiV1.get('/user/transactions');
    const raw = Array.isArray(res.data?.transactions) ? res.data.transactions : [];
    return raw.map((tx: any) => ({
      id: String(tx.id),
      amount: Number(tx.amount ?? 0),
      artistName: (tx.artistName ?? tx.artist_name ?? '').toString(),
      date: (tx.date ?? '').toString(),
      status: (tx.status ?? '').toString(),
    }));
  },

  async getListenTime() {
    try {
      const res = await apiV1.get('/user/listen-time');
      return {
        totalMinutes: Number(res.data?.totalMinutes || 0),
        formattedTime: (res.data?.formattedTime || '0m').toString()
      };
    } catch (err: any) {
      logger.warn('[userService] getListenTime failed - status:', err?.response?.status, 'msg:', err?.message);
      return { totalMinutes: 0, formattedTime: '—' };
    }
  },

  async getSubscriptionPlanSummary() {
    try {
      const res = await apiV1.get('/subscriptions/summary');
      const data = res.data ?? {};
      if (!data.success) {
        logger.warn('[userService] getSubscriptionPlanSummary returned success=false', data);
        return null;
      }

      const artistPlan = mapSubRecord(data.artistPlan);
      const platformPlan = mapSubRecord(data.platformPlan);
      const legacyPlan = mapSubRecord(data.plan);
      const activePlan = artistPlan ?? legacyPlan;

      return {
        // Legacy fields (for backward compat)
        status: (activePlan?.status ?? '').toString(),
        planType: (activePlan?.planType ?? 'MONTHLY').toString(),
        endDate: activePlan?.endDate ?? null,
        artistId: activePlan?.artistId ?? null,
        artistName: activePlan?.artistName,
        // New fields
        artistPlan,
        platformPlan,
        artistSubCount: Number(data.artistSubCount ?? 0),
      };
    } catch (err: any) {
      logger.warn('[userService] getSubscriptionPlanSummary FAILED - HTTP status:', err?.response?.status, 'message:', err?.message);
      return null;
    }
  },

  async checkContentAccess(contentId: number, artistId: string): Promise<AccessCheckResult> {
    try {
      const res = await apiV1.get('/subscriptions/access-check', {
        params: { contentId, artistId },
      });
      return {
        allowed: Boolean(res.data?.allowed),
        reason: (res.data?.reason ?? '').toString(),
        graceEndsAt: res.data?.graceEndsAt ? String(res.data.graceEndsAt) : undefined,
      };
    } catch {
      return { allowed: false, reason: 'ERROR' };
    }
  },

  async checkStreamingQuality(): Promise<QualityResult> {
    try {
      const res = await apiV1.get('/subscriptions/quality');
      return {
        quality: res.data?.quality === 'HD' ? 'HD' : 'SD',
        maxResolution: (res.data?.maxResolution ?? '1080p').toString(),
        isGrace: Boolean(res.data?.isGrace),
      };
    } catch {
      // Phase 09A removed the historical commercial HD/SD entitlement. If this
      // legacy compatibility endpoint is temporarily unavailable, never invent a
      // 240p cap or platform-plan upsell. /stream/access remains authoritative
      // for the actual source-backed adaptive rendition set.
      return { quality: 'HD', maxResolution: '1080p' };
    }
  },

  async updateProfile(input: UpdateProfileInput) {
    const res = await apiV1.put('/user/update', input);
    return res.data?.profile;
  },

  async updatePassword(input: UpdatePasswordInput) {
    const res = await apiV1.put('/user/update-password', input);
    return res.data;
  },

  async uploadProfileImage(uri: string, mimeType: string, fileName: string) {
    const formData = new FormData();
    formData.append('image', {
      uri,
      type: mimeType,
      name: fileName,
    } as any);

    const res = await apiV1.post('/user/profile-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data?.profileImageUrl;
  },

  async updateSettings(input: UpdateSettingsInput) {
    const res = await apiV1.put('/user/settings', {
      pushNotifications: input.pushNotifications,
      audioQualityPref: input.audioQuality,
    });
    return res.data;
  },

  async getPlatformConfig() {
    try {
      const res = await apiV1.get('/subscriptions/platform-config');
      if (res.data?.success && res.data.config) {
        return res.data.config as PlatformConfig;
      }
      return null;
    } catch {
      return null;
    }
  },

  async getSubscriptionDetails() {
    try {
      const res = await apiV1.get('/subscriptions/details');
      logger.log('[userService] getSubscriptionDetails raw response success:', res.data?.success, 'platform:', !!res.data?.platform, 'artists:', res.data?.artists?.length);
      if (res.data?.success) {
        return {
          platform: mapSubRecord(res.data.platform),
          artists: (res.data.artists || []).map((a: any) => mapSubRecord(a)),
          transactions: (res.data.transactions || []).map((tx: any) => ({
            id: String(tx.id),
            amount: Number(tx.amount ?? 0),
            artistName: (tx.artistName ?? tx.artist_name ?? '').toString(),
            date: (tx.date ?? '').toString(),
            status: (tx.status ?? '').toString(),
            artistId: tx.artist_id ? String(tx.artist_id) : undefined,
            razorpayPaymentId: tx.razorpay_payment_id ? String(tx.razorpay_payment_id) : undefined,
            billingCycle: (tx.billingCycle ?? tx.billing_cycle ?? 'monthly').toString(),
          }))
        };
      }
      return null;
    } catch (err: any) {
      logger.warn('[userService] getSubscriptionDetails FAILED - HTTP status:', err?.response?.status, 'message:', err?.message, 'url:', err?.config?.url);
      return null;
    }
  },

  async getFullSubscriptionStatus() {
    try {
      const res = await apiV1.get('/subscriptions/status');
      if (res.data?.success) {
        return {
          platform: mapSubRecord(res.data.platform),
          artists: (res.data.artists || []).map((a: any) => mapSubRecord(a)),
          count: Number(res.data.count || 0)
        };
      }
      return null;
    } catch {
      return null;
    }
  },

  async trackUpsellAttempt() {
    try {
      await apiV1.post('/subscriptions/upsell/track');
    } catch (err) {
      logger.warn('[Upsell] Track attempt failed', err);
    }
  },

  async getUpsellStatus() {
    try {
      const res = await apiV1.get('/subscriptions/upsell/status');
      return res.data as UpsellStatus;
    } catch {
      return null;
    }
  },

  async getArtistProfile(artistId: number): Promise<ArtistProfile | null> {
    try {
      const res = await apiV1.get(`/artists/${artistId}`);
      if (res.data?.success && res.data.artist) {
        const a = res.data.artist;
        return {
          id: Number(a.id),
          name: (a.name ?? '').toString(),
          subscriptionPrice: Number(a.subscriptionPrice ?? 0),
          isVerified: Boolean(a.isVerified),
          profileImageUrl: a.profileImageUrl,
          bio: a.bio,
          subscriptionFeatures: Array.isArray(a.subscriptionFeatures) ? a.subscriptionFeatures : [],
        };
      }
      return null;
    } catch {
      return null;
    }
  },

  async toggleAutoRenew(subId: string | number, autoRenew: boolean) {
    try {
      const res = await apiV1.patch(`/subscriptions/${subId}/toggle-auto-renew`, { auto_renew: autoRenew });
      return Boolean(res.data?.success);
    } catch {
      return false;
    }
  },

  async cancelSubscription(subId: string | number, input: { reason: string; feedback?: string; accepted_retention_offer?: boolean }) {
    const res = await apiV1.post(`/subscriptions/${subId}/cancel`, input);
    return res.data;
  },

  getInvoiceUrl(txId: string | number) {
    // Return absolute URL for PDF download
    const baseURL = apiV1.defaults.baseURL || '';
    return `${baseURL}/user/transactions/${txId}/invoice`;
  }
};
