import React from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Linking,
  Image,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { useAuth } from '../store/authStore';
import { CreditCard, HelpCircle, Library, LogOut, User, Camera, Crown, ShieldCheck, Lock, ArrowLeft, X } from 'lucide-react-native';
import { SubscriptionStatusCard, DetailedPlatformCard, ArtistSubscriptionItem, EmptySubscriptionState } from '../ui/SubscriptionUI';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { userService, type AudioQualityPref, type SubscriptionPlanSummary, type Transaction } from '../services/userService';
import { JWT_STORAGE_KEY, API_BASE_URL } from '../services/api';
import { resetToLogin } from '../navigation/rootNavigation';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../theme';
import { ARTIST_WEB_URL } from '../config/env';
import { registerForPushNotifications, disablePushNotifications } from '../services/notificationService';

function PremiumBadge() {
  return (
    <View style={styles.premiumBadge}>
      <Text style={styles.premiumBadgeText}>Premium Member</Text>
    </View>
  );
}

export default function AccountScreen() {
  const { user, userAccountStatus, logout } = useAuth();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const scrollContentPaddingBottom = React.useMemo(() => {
    return Math.max(insets.bottom, 0) + 110;
  }, [insets.bottom]);

  const performLogout = React.useCallback(async () => {
    console.log('DEBUG: Logout initiated');

    try {
      console.log('DEBUG: Attempting to clear AsyncStorage...');
      await AsyncStorage.multiRemove(['userToken', 'userInfo']);
      await AsyncStorage.multiRemove([JWT_STORAGE_KEY, 'sessionUser']);
      console.log('DEBUG: AsyncStorage cleared successfully');

      await logout();
      console.log('DEBUG: Global state updated, triggering redirect...');

      resetToLogin();

      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        })
      );
      console.log('DEBUG: Navigation reset command sent');
    } catch (error: any) {
      console.error('DEBUG_ERROR: Logout failed during execution:', error);
      Alert.alert('Logout Error', 'Logout Error: ' + (error?.message ?? String(error)));
    }
  }, [logout, navigation]);

  const [isLoading, setIsLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [profileName, setProfileName] = React.useState<string>('');
  const [profileImageUrl, setProfileImageUrl] = React.useState<string>('');
  const [isPremium, setIsPremium] = React.useState(false);
  const [subscriptionCount, setSubscriptionCount] = React.useState(0);
  const [planSummary, setPlanSummary] = React.useState<SubscriptionPlanSummary | null>(null);
  const [artistSubs, setArtistSubs] = React.useState<any[]>([]);
  const [platformPlan, setPlatformPlan] = React.useState<any | null>(null);


  const [listenTime, setListenTime] = React.useState<string>('');
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);

  const [pushNotifications, setPushNotifications] = React.useState(true);
  const [audioQuality, setAudioQuality] = React.useState<AudioQualityPref>('HIGH');

  const [showTransactions, setShowTransactions] = React.useState(false);
  const [showHelpSupport, setShowHelpSupport] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [profileRes, detailsRes, listenRes, planRes] = await Promise.allSettled([
        userService.getUserProfile(),
        userService.getSubscriptionDetails(),
        userService.getListenTime(),
        userService.getSubscriptionPlanSummary(),
      ]);

      if (profileRes.status === 'fulfilled') {
        const p = profileRes.value;
        setProfileName(p.name);
        setProfileImageUrl(p.profileImageUrl || '');
        setIsPremium(p.isPremium);
        setSubscriptionCount(p.subscriptionCount);
      } else {
        console.warn('[AccountScreen] getUserProfile failed:', profileRes.reason);
      }

      if (detailsRes.status === 'fulfilled' && detailsRes.value) {
        const details = detailsRes.value;
        setPlatformPlan(details.platform);
        setArtistSubs(details.artists || []);
        setTransactions(details.transactions || []);
        console.log(`[AccountScreen] Subscriptions loaded: ${details.artists?.length || 0} artists, Transactions: ${details.transactions?.length || 0}`);
      } else {
        const reason = detailsRes.status === 'rejected' ? detailsRes.reason : 'No data';
        console.warn('[AccountScreen] getSubscriptionDetails failed or empty:', reason);
      }

      if (listenRes.status === 'fulfilled') {
        console.log('[AccountScreen] Listen time success:', listenRes.value.formattedTime);
        setListenTime(listenRes.value.formattedTime);
      } else {
        console.warn('[AccountScreen] getListenTime failed:', listenRes.reason);
        setListenTime('—');
      }

      if (planRes.status === 'fulfilled') {
        setPlanSummary(planRes.value);
      } else {
        console.warn('[AccountScreen] getSubscriptionPlanSummary failed:', planRes.reason);
      }

    } catch (error: any) {
      console.error('[AccountScreen] refresh error:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  const [showArtistSubList, setShowArtistSubList] = React.useState(false);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    refresh();
  }, [refresh]);

  const planStatusText = React.useMemo(() => {
    const raw = (planSummary?.status ?? '').toString().toUpperCase();
    if (raw === 'ACTIVE') return 'Active';
    if (!raw) return '—';
    return raw;
  }, [planSummary?.status]);

  const planEndDateText = React.useMemo(() => {
    const raw = planSummary?.endDate;
    if (!raw) return '—';
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }, [planSummary?.endDate]);

  const handleRenewArtist = React.useCallback(() => {
    const plan = planSummary?.artistPlan;
    navigation.navigate('SubscriptionFlow', {
      artistId: plan?.artistId ?? '',
      artistName: plan?.artistName ?? 'Artist',
      defaultPlan: 'ARTIST',
    });
  }, [planSummary, navigation]);

  const handleRenewPlatform = React.useCallback(() => {
    navigation.navigate('SubscriptionFlow', { defaultPlan: 'PLATFORM' });
  }, [navigation]);

  const handleUpgrade = React.useCallback(() => {
    navigation.navigate('SubscriptionFlow', {});
  }, [navigation]);

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      refresh();
    });
    return unsubscribe;
  }, [navigation, refresh]);

  const handleLogout = () => {
    console.log('LOGOUT_CLICKED');

    if (Platform.OS === 'web') {
      const confirmed =
        typeof window !== 'undefined'
          ? window.confirm('Are you sure you want to log out?')
          : true;
      if (confirmed) {
        void performLogout();
      }
      return;
    }

    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: () => {
            void performLogout();
          },
        },
      ]
    );
  };

  const getStatusColor = () => {
    return userAccountStatus === 'ACTIVE' ? '#10B981' : '#DC2626';
  };

  const getStatusText = () => {
    return userAccountStatus === 'ACTIVE' ? 'Active' : 'Suspended';
  };

  const handleToggleNotifications = async (next: boolean) => {
    console.log('[AccountScreen] Toggle notifications:', next);
    try {
      if (next) {
        // Enable: request OS permission, fetch token, sync to backend
        const result = await registerForPushNotifications();
        console.log('[AccountScreen] Register result:', result);
        if (result.success) {
          setPushNotifications(true);
        } else {
          setPushNotifications(false);
          if (result.status === 'denied') {
            Alert.alert(
              'Notifications Blocked',
              'Please enable notifications for this app in Settings → Music Streaming Platform → Notifications.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ]
            );
          } else {
            Alert.alert(
              'Notifications Failed',
              'Unable to enable notifications. Please try again.',
              [{ text: 'OK', style: 'default' }]
            );
          }
        }
      } else {
        // Disable: tell backend to clear the preference
        await disablePushNotifications();
        setPushNotifications(false);
      }
    } catch (err) {
      console.error('[AccountScreen] Notification toggle error:', err);
      Alert.alert(
        'Error',
        'Failed to update notification settings. Please try again.',
        [{ text: 'OK', style: 'default' }]
      );
      // Revert UI on unexpected error
      setPushNotifications((v) => !v);
    }
  };

  const handleOpenArtistDashboard = async () => {
    if (user?.role === 'ARTIST') {
      const dashboardUrl = ARTIST_WEB_URL + '/artist/dashboard';
      try {
        const canOpen = await Linking.canOpenURL(dashboardUrl);
        if (!canOpen) {
          Alert.alert(
            'Cannot Open Dashboard',
            'Unable to open the artist dashboard. Please try again later or contact support.',
            [{ text: 'OK', style: 'default' }]
          );
          return;
        }
        await Linking.openURL(dashboardUrl);
      } catch (err) {
        console.error('[AccountScreen] Failed to open artist dashboard:', err);
        Alert.alert(
          'Error Opening Dashboard',
          'Something went wrong while trying to open the artist dashboard. Please try again.',
          [{ text: 'OK', style: 'default' }]
        );
      }
    } else {
      navigation.navigate('ArtistOnboarding');
    }
  };

  const handleSelectQuality = async (next: AudioQualityPref) => {
    setAudioQuality(next);
    try {
      await userService.updateSettings({ audioQuality: next });
    } catch {
      // ignore
    }
  };

  const handleOpenEditProfile = () => {
    navigation.navigate('EditProfile');
  };

  const handleChangeProfileImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library to change your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      try {
        setIsLoading(true);
        const newImageUrl = await userService.uploadProfileImage(
          asset.uri,
          asset.mimeType || 'image/jpeg',
          asset.fileName || 'profile.jpg'
        );
        const freshUri = newImageUrl ? `${newImageUrl.split('?')[0]}?t=${Date.now()}` : '';
        setProfileImageUrl(freshUri);
      } catch (error: any) {
        Alert.alert('Error', 'Failed to upload profile image. Please try again.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleDownloadInvoice = async (transactionId: string) => {
    try {
      Alert.alert('Download', 'Preparing your invoice...');
      
      const downloadUrl = `${API_BASE_URL}/user/transactions/${transactionId}/invoice`;
      const token = await AsyncStorage.getItem(JWT_STORAGE_KEY) || await AsyncStorage.getItem('userToken');
      
      console.log('[AccountScreen] Download URL:', downloadUrl);
      console.log('[AccountScreen] Platform:', Platform.OS);
      console.log('[AccountScreen] Token exists:', !!token);
      
      // Web: Fetch with Authorization header, create blob, then download
      if (Platform.OS === 'web') {
        const response = await fetch(downloadUrl, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!response.ok) {
          throw new Error(`Download failed: ${response.status}`);
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice_${transactionId}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        Alert.alert('Success', 'Invoice downloaded successfully');
        return;
      }
      
      // Mobile: Download to device storage
      const fileUri = `${(FileSystem as any).documentDirectory}invoice_${transactionId}.pdf`;
      console.log('[AccountScreen] File URI:', fileUri);
      
      const downloadRes = await FileSystem.downloadAsync(
        downloadUrl,
        fileUri,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      console.log('[AccountScreen] Download response:', downloadRes);

      if (downloadRes.status === 200) {
        // Use Sharing API to make the file accessible to user
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Save Invoice',
            UTI: 'com.adobe.pdf',
          });
        } else {
          Alert.alert('Downloaded', 'Invoice saved to app storage. You can access it from the app.');
        }
      } else {
        throw new Error('Download failed with status ' + downloadRes.status);
      }
    } catch (error: any) {
      console.error('[AccountScreen] Invoice download error:', error);
      console.error('[AccountScreen] Error details:', JSON.stringify(error, null, 2));
      Alert.alert('Error', 'Failed to download invoice. Please try again later.');
    }
  };

  return (
    <LinearGradient
      colors={Colors.backgroundGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradientBackground}
    >
      <SafeAreaView style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollContentPaddingBottom }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#4AA3FF"
              colors={['#4AA3FF']}
            />
          }
        >
          <View style={styles.header}>
            <Text style={styles.title}>Account</Text>
            <Text style={styles.sub}>Manage your profile and settings.</Text>
          </View>

        <View style={styles.section}>
          <View style={styles.profileCard}>
            <View style={styles.profileAvatarRow}>
              <TouchableOpacity onPress={handleChangeProfileImage} disabled={isLoading}>
                {profileImageUrl ? (
                  <Image source={{ uri: profileImageUrl }} style={styles.profileAvatar} />
                ) : (
                  <View style={styles.profileAvatarPlaceholder}>
                    <User size={40} color="#fff" />
                  </View>
                )}
                <View style={styles.cameraIconOverlay}>
                  <Camera size={18} color="#fff" />
                </View>
              </TouchableOpacity>
            </View>
            <View style={styles.profileTitleRow}>
              <Text style={styles.profileName}>{profileName || user?.name?.toString?.() || (user as any)?.fullName || (user as any)?.full_name || 'User'}</Text>
              {!isLoading && isPremium ? <PremiumBadge /> : null}
            </View>
            <Text style={styles.profileEmail}>{user?.email || 'Not available'}</Text>

            <View style={styles.statsRow}>
              <TouchableOpacity 
                style={styles.statBox} 
                onPress={() => setShowArtistSubList(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.statValue}>{artistSubs.length || subscriptionCount || 0}</Text>
                <Text style={styles.statLabel}>Subscribed Artists</Text>
              </TouchableOpacity>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{listenTime || '—'}</Text>
                <Text style={styles.statLabel}>Monthly Listening</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={handleOpenEditProfile} disabled={isLoading}>
              <Text style={styles.primaryButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          {/* ────────────────────────────────────────────────────────── */}
          {/*   MY SUBSCRIPTIONS SECTION (REDESIGNED)              */}
          {/* ────────────────────────────────────────────────────────── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Subscriptions</Text>
            {isPremium && (
              <TouchableOpacity onPress={() => navigation.navigate('SubscriptionFlow')}>
                <Text style={styles.sectionAction}>Explore More</Text>
              </TouchableOpacity>
            )}
          </View>

          {!isPremium && artistSubs.length === 0 && !platformPlan && !isLoading ? (
            <EmptySubscriptionState onExplore={() => navigation.navigate('SubscriptionFlow')} />
          ) : (
            <View style={styles.subscriptionGroups}>
              {/* Part A: Platform Subscription */}
              {platformPlan && (
                <View style={styles.subGroup}>
                  <Text style={styles.subGroupTitle}>PLATFORM SUBSCRIPTION</Text>
                  <DetailedPlatformCard 
                    plan={platformPlan} 
                    onManage={() => navigation.navigate('SubscriptionDetail', { type: 'PLATFORM' })}
                    onUpgrade={() => navigation.navigate('SubscriptionFlow', { defaultPlan: 'PLATFORM' })}
                  />
                </View>
              )}

              {/* Part B: Artist Subscriptions */}
              {artistSubs.length > 0 && (
                <View style={styles.subGroup}>
                  <Text style={styles.subGroupTitle}>ARTIST SUBSCRIPTIONS</Text>
                  {artistSubs.map(sub => (
                    <ArtistSubscriptionItem 
                      key={sub.artistId || sub.id} 
                      sub={sub} 
                      onPress={() => navigation.navigate('SubscriptionDetail', { artistId: sub.artistId, type: 'ARTIST' })}
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Upsell if no Platform sub */}
          {!platformPlan && isPremium && (
            <TouchableOpacity 
              style={styles.upsellNudge}
              onPress={() => navigation.navigate('SubscriptionFlow', { defaultPlan: 'PLATFORM' })}
            >
              <Crown color={Colors.accent} size={20} />
              <Text style={styles.upsellNudgeText}>Upgrade to <Text style={{fontWeight:'900', color: Colors.accent}}>Platform Plan</Text> for HD streaming</Text>
              <ArrowLeft style={{transform: [{rotate: '180deg'}]}} color={Colors.accent} size={16} />
            </TouchableOpacity>
          )}

          <View style={{ height: 20 }} />
        </View>

        {/* Account Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Status</Text>
          <View style={styles.statusCard}>
            <View style={styles.statusLeft}>
              <User size={20} color="#fff" />
              <View style={styles.statusInfo}>
                <Text style={styles.statusLabel}>Account Status</Text>
                <Text style={[styles.statusValue, { color: getStatusColor() }]}>
                  {getStatusText()}
                </Text>
              </View>
            </View>
            <View style={[styles.statusIndicator, { backgroundColor: getStatusColor() }]} />
          </View>
        </View>

        {/* Account Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={handleOpenArtistDashboard}
          >
            <User size={20} color="#fff" />
            <Text style={styles.menuText}>{user?.role === 'ARTIST' ? 'Artist Dashboard' : 'Become an Artist'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('MyLibrary')}
          >
            <Library size={20} color="#fff" />
            <Text style={styles.menuText}>My Library</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.menuItem} onPress={() => setShowTransactions(true)}>
            <CreditCard size={20} color="#fff" />
            <Text style={styles.menuText}>Subscription & Billing</Text>
          </TouchableOpacity>

          <View style={styles.prefRow}>
            <Text style={styles.prefLabel}>Push Notifications</Text>
            <Switch value={pushNotifications} onValueChange={handleToggleNotifications} />
          </View>


          <TouchableOpacity style={styles.menuItem} onPress={() => setShowHelpSupport(true)}>
            <HelpCircle size={20} color="#fff" />
            <Text style={styles.menuText}>Help & Support</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <LogOut size={20} color={Colors.accent} />
            <Text style={[styles.menuText, { color: Colors.accent }]}>Log Out</Text>
          </TouchableOpacity>
        </View>

        {/* User Info */}
        {user && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile Information</Text>
            <View style={styles.userInfo}>
              <Text style={styles.userInfoLabel}>Email</Text>
              <Text style={styles.userInfoValue}>{user.email || 'Not available'}</Text>
              <Text style={styles.userInfoLabel}>Name</Text>
              <Text style={styles.userInfoValue}>{profileName || user.name || (user as any).fullName || (user as any).full_name || 'Not set'}</Text>
            </View>
          </View>
        )}
        </ScrollView>

      <Modal visible={showTransactions} animationType="slide" onRequestClose={() => setShowTransactions(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, 20) }]}>
            <View style={styles.modalHeaderContent}>
              <Text style={styles.modalTitle}>Billing History</Text>
              <Text style={styles.modalSubTitle}>Track all your premium payments</Text>
            </View>
            <TouchableOpacity 
              onPress={() => setShowTransactions(false)} 
              style={styles.modalCloseBtn}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            >
              <X color="#fff" size={22} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            {transactions.map((tx) => (
              <View key={tx.id} style={styles.txRow}>
                <View style={styles.txLeft}>
                  <Text style={styles.txArtist}>{tx.artistName || 'Platform Plan'}</Text>
                  <Text style={styles.txDate}>{new Date(tx.date).toLocaleDateString()}</Text>
                </View>
                <View style={[styles.txRight, { flexDirection: 'row', alignItems: 'center' }]}>
                  <View style={{ alignItems: 'flex-end', marginRight: 16 }}>
                    <Text style={styles.txAmount}>₹{(tx.amount / 100).toFixed(2)}</Text>
                    <Text style={[styles.txStatus, { color: tx.status === 'CAPTURED' || tx.status === 'SUCCESS' ? '#10B981' : '#FFA500' }]}>
                      {tx.status ?? 'PENDING'}
                    </Text>
                  </View>
                  <TouchableOpacity 
                    style={styles.downloadIcon} 
                    onPress={() => handleDownloadInvoice(tx.id)}
                  >
                    <Text style={{ color: Colors.accent, fontSize: 12, fontWeight: '600' }}>Download</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {transactions.length === 0 ? (
              <View style={styles.modalEmptyWrap}>
                <View style={styles.modalEmptyIconCircle}>
                  <CreditCard size={40} color="rgba(255,255,255,0.25)" />
                </View>
                <Text style={styles.modalEmptyText}>No Transactions Yet</Text>
                <Text style={styles.modalEmptySub}>Your complete billing history will appear here once you subscribe to an artist or platform plan.</Text>
                <TouchableOpacity 
                  style={styles.modalEmptyBtn}
                  onPress={() => {
                    setShowTransactions(false);
                    navigation.navigate('SubscriptionFlow');
                  }}
                >
                  <Text style={styles.modalEmptyBtnText}>Explore Plans</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {transactions.length > 0 && (
              <View style={styles.trustFooter}>
                <View style={styles.trustItem}>
                  <ShieldCheck size={16} color="rgba(255,255,255,0.4)" />
                  <Text style={styles.trustText}>Razorpay Secure</Text>
                </View>
                <View style={styles.trustItem}>
                  <Lock size={16} color="rgba(255,255,255,0.4)" />
                  <Text style={styles.trustText}>SSL Encrypted</Text>
                </View>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showArtistSubList} animationType="slide" onRequestClose={() => setShowArtistSubList(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, 20) }]}>
            <View style={styles.modalHeaderContent}>
              <Text style={styles.modalTitle}>Your Artists</Text>
              <Text style={styles.modalSubTitle}>Artists you are currently supporting</Text>
            </View>
            <TouchableOpacity 
              onPress={() => setShowArtistSubList(false)} 
              style={styles.modalCloseBtn}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            >
              <X color="#fff" size={22} />
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.modalScroll} 
            contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {artistSubs.length > 0 ? (
              artistSubs.map((sub) => (
                <ArtistSubscriptionItem 
                  key={sub.artistId || sub.id} 
                  sub={sub} 
                  onPress={() => {
                    setShowArtistSubList(false);
                    navigation.navigate('SubscriptionDetail', { artistId: sub.artistId, type: 'ARTIST' });
                  }}
                />
              ))
            ) : (
              <View style={styles.modalEmptyWrap}>
                <View style={styles.modalEmptyIconCircle}>
                  <Library size={40} color="rgba(255,255,255,0.25)" />
                </View>
                <Text style={styles.modalEmptyText}>No Artist Plans</Text>
                <Text style={styles.modalEmptySub}>Subscribe to your favorite artists to unlock exclusive content and support their work.</Text>
                <TouchableOpacity 
                  style={styles.modalEmptyBtn}
                  onPress={() => {
                    setShowArtistSubList(false);
                    navigation.navigate('SubscriptionFlow');
                  }}
                >
                  <Text style={styles.modalEmptyBtnText}>Find Artists</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showHelpSupport} animationType="slide" onRequestClose={() => setShowHelpSupport(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, 20) }]}>
            <View style={styles.modalHeaderContent}>
              <Text style={styles.modalTitle}>Help & Support</Text>
              <Text style={styles.modalSubTitle}>Find answers to common questions</Text>
            </View>
            <TouchableOpacity 
              onPress={() => setShowHelpSupport(false)} 
              style={styles.modalCloseBtn}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            >
              <X color="#fff" size={22} />
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.modalScroll} 
            contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.faqSection}>
              <Text style={styles.faqSectionTitle}>Frequently Asked Questions</Text>
              
              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>How do I subscribe to an artist?</Text>
                <Text style={styles.faqAnswer}>Go to the artist's profile and tap the "Subscribe" button. You can choose between monthly or yearly plans. Subscribing unlocks exclusive content and supports your favorite artists directly.</Text>
              </View>

              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>What is the Platform Plan?</Text>
                <Text style={styles.faqAnswer}>The Platform Plan gives you HD streaming across all content, ad-free experience, and crystal clear audio quality. It's the best value for users who want premium features across the entire platform.</Text>
              </View>

              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>How do I cancel my subscription?</Text>
                <Text style={styles.faqAnswer}>You can cancel your subscription anytime from the Account Settings. Go to "Subscription & Billing" section and select the subscription you want to cancel. Your benefits will continue until the end of the current billing period.</Text>
              </View>

              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>Can I download songs for offline listening?</Text>
                <Text style={styles.faqAnswer}>Yes! With a Platform Plan or Artist Subscription, you can download songs for offline listening. Simply tap the download button on any track to save it to your device.</Text>
              </View>

              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>How do I become an artist on the platform?</Text>
                <Text style={styles.faqAnswer}>Tap "Become an Artist" in your Account Settings. You'll be guided through the onboarding process where you can set up your artist profile, upload your music, and start earning from your subscribers.</Text>
              </View>

              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>What payment methods do you accept?</Text>
                <Text style={styles.faqAnswer}>We accept all major payment methods including credit cards, debit cards, UPI, and net banking through Razorpay. All payments are secure and encrypted.</Text>
              </View>
            </View>

            <View style={styles.contactSection}>
              <Text style={styles.contactTitle}>Still need help?</Text>
              <Text style={styles.contactSub}>Our support team is here to assist you</Text>
              
              <TouchableOpacity style={styles.contactBtn}>
                <Text style={styles.contactBtnText}>Contact Support</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.contactBtnSecondary}>
                <Text style={styles.contactBtnTextSecondary}>Email: support@musicplatform.com</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradientBackground: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 30,
    paddingHorizontal: 24,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  sub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    marginLeft: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionAction: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  subscriptionGroups: {
    gap: 16,
  },
  subGroup: {
    marginBottom: 8,
  },
  subGroupTitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  upsellNudge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,181,8,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,181,8,0.15)',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  upsellNudgeText: {
    flex: 1,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 10,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 16,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusInfo: {
    marginLeft: 12,
    flex: 1,
  },
  statusLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
  },
  statusValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  menuContent: {
    marginLeft: 12,
    flex: 1,
  },
  menuText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  menuSubText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  userInfo: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 16,
  },
  userInfoLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 12,
    marginBottom: 4,
  },
  userInfoValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },

  profileAvatarRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  profileAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  profileAvatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  cameraIconOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0B0B0B',
  },
  profileCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 16,
  },
  profileTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  profileEmail: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '500',
  },
  premiumBadge: {
    backgroundColor: 'rgba(255,181,8,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(255,181,8,0.45)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  premiumBadgeText: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: '800',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  statValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  statLabel: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 14,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonSmall: {
    flex: 1,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '900',
  },
  upgradeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(74,163,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(74,163,255,0.22)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  upgradeCtaTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  upgradeCtaSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  upgradeCtaArrow: { color: '#4AA3FF', fontSize: 18, fontWeight: '900' },
  nudgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(74,163,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(74,163,255,0.18)',
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  nudgeText: { flex: 1, color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginLeft: 8 },
  nudgeArrow: { color: '#4AA3FF', fontSize: 16, fontWeight: '900' },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  prefLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  qualityCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  qualityTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  qualityRow: {
    flexDirection: 'row',
    gap: 10,
  },
  qualityPill: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  qualityPillActive: {
    borderColor: 'rgba(255,106,0,0.6)',
    backgroundColor: 'rgba(255,106,0,0.12)',
  },
  qualityPillText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  qualityPillSub: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
  },

  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  modalHeaderContent: {
    flex: 1,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  modalSubTitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 15,
  },
  modalScroll: {
    flex: 1,
    paddingHorizontal: 20,
  },
  modalEmptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 120,
    paddingHorizontal: 40,
  },
  modalEmptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  modalEmptyText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  modalEmptySub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 22,
  },
  modalEmptyBtn: {
    marginTop: 30,
    paddingHorizontal: 30,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modalEmptyBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  txLeft: {
    flex: 1,
  },
  txArtist: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  txDate: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  txRight: {
    alignItems: 'flex-end',
  },
  txAmount: {
    color: '#4AA3FF',
    fontSize: 16,
    fontWeight: '900',
  },
  txStatus: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  downloadIcon: {
    padding: 8,
    backgroundColor: 'rgba(255,106,0,0.1)',
    borderRadius: 8,
  },
  faqSection: {
    marginBottom: 30,
  },
  faqSectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 20,
  },
  faqItem: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  faqQuestion: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  faqAnswer: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 20,
  },
  contactSection: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  contactTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  contactSub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 20,
  },
  contactBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 25,
    marginBottom: 12,
  },
  contactBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
  },
  contactBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  contactBtnTextSecondary: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  trustFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 24,
    marginBottom: 40,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trustText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    marginTop: 20,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  editModalCard: {
    width: '100%',
    backgroundColor: '#0B0B0B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    padding: 16,
  },
  editTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
  },
  inputLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
});
