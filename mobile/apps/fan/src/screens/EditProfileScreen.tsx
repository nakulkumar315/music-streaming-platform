import React, { useState, useEffect, useMemo } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  ActivityIndicator, 
  KeyboardAvoidingView, 
  Platform, 
  ScrollView,
  Image,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Camera, Lock } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../store/authStore';
import { userService, UserProfile } from '../services/userService';
import { getOptimizedImageUrl } from '../utils/cloudinary';

export default function EditProfileScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [favoriteGenre, setFavoriteGenre] = useState('');
  const [location, setLocation] = useState('');
  const [profileImageUri, setProfileImageUri] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Initial values to check if form is dirty
  const [initialValues, setInitialValues] = useState<any>({});

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setIsLoading(true);
      const p = await userService.getUserProfile();
      setProfile(p);
      
      const pFullName = p.fullName || p.name || '';
      const pUsername = p.username || '';
      const pBio = p.bio || '';
      const pGenre = p.favoriteGenre || '';
      const pLoc = p.location || '';
      const pImage = p.profileImageUrl || '';
      
      setFullName(pFullName);
      setUsername(pUsername);
      setBio(pBio);
      setFavoriteGenre(pGenre);
      setLocation(pLoc);
      setProfileImageUri(pImage);
      
      setInitialValues({
        fullName: pFullName,
        username: pUsername,
        bio: pBio,
        favoriteGenre: pGenre,
        location: pLoc,
        profileImageUri: pImage
      });
      
    } catch (err) {
      console.error('Failed to load profile', err);
      setErrorMsg('Failed to load profile details');
    } finally {
      setIsLoading(false);
    }
  };

  const isDirty = useMemo(() => {
    return fullName !== initialValues.fullName ||
           username !== initialValues.username ||
           bio !== initialValues.bio ||
           favoriteGenre !== initialValues.favoriteGenre ||
           location !== initialValues.location ||
           profileImageUri !== initialValues.profileImageUri;
  }, [fullName, username, bio, favoriteGenre, location, profileImageUri, initialValues]);

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        uploadImage(result.assets[0]);
      }
    } catch (error) {
      console.error("Image pick error", error);
      Alert.alert("Error", "Could not pick image");
    }
  };

  const uploadImage = async (asset: ImagePicker.ImagePickerAsset) => {
    setIsUploadingImage(true);
    setErrorMsg("");
    setSuccessMsg("");

    // ============================================
    // BUG FIX: Check file size before upload (2MB limit)
    // ============================================
    const fileSize = asset.fileSize || 0;
    const MAX_SIZE = 2 * 1024 * 1024; // 2MB

    if (fileSize > MAX_SIZE) {
      Alert.alert(
        "File Too Large",
        `Please select an image under 2MB. Your file is ${(
          fileSize /
          (1024 * 1024)
        ).toFixed(2)}MB.`
      );
      setIsUploadingImage(false);
      return;
    }

    try {
      // Create a readable filename and mimeType
      let mimeType = asset.mimeType || "image/jpeg";
      let fileExt = "jpg";
      if (asset.uri.startsWith("data:image/png") || mimeType.includes("png")) {
        fileExt = "png";
        mimeType = "image/png";
      } else if (asset.uri.startsWith("data:image/webp") || mimeType.includes("webp")) {
        fileExt = "webp";
        mimeType = "image/webp";
      } else if (asset.uri.startsWith("data:image/jpeg") || mimeType.includes("jpeg") || mimeType.includes("jpg")) {
        fileExt = "jpg";
        mimeType = "image/jpeg";
      } else {
        const uriParts = asset.uri.split(".");
        const lastPart = uriParts[uriParts.length - 1]?.split(/[?#]/)[0]?.toLowerCase();
        if (["png", "jpg", "jpeg", "webp"].includes(lastPart)) {
          fileExt = lastPart === "jpeg" ? "jpg" : lastPart;
          mimeType = fileExt === "png" ? "image/png" : (fileExt === "webp" ? "image/webp" : "image/jpeg");
        }
      }
      const fileName = asset.fileName || `profile-${Date.now()}.${fileExt}`;

      const newImageUrl = await userService.uploadProfileImage(
        asset.uri,
        mimeType,
        fileName,
        asset.base64
      );
      setProfileImageUri(newImageUrl);
      setSuccessMsg("Profile photo uploaded successfully!");
    } catch (err: any) {
      setErrorMsg(
        err.response?.data?.message || err.message || "Image upload failed"
      );
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      setErrorMsg("Full Name is required");
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');
    setIsSaving(true);
    
    try {
      await userService.updateProfile({
        fullName,
        username,
        bio,
        favoriteGenre,
        location
      });
      setSuccessMsg('Profile updated successfully!');
      
      setInitialValues({
        fullName,
        username,
        bio,
        favoriteGenre,
        location,
        profileImageUri
      });
      
      setTimeout(() => {
        navigation.goBack();
      }, 1500);
      
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    if (isDirty) {
      Alert.alert(
        "Unsaved Changes",
        "You have unsaved changes. Are you sure you want to leave?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => navigation.goBack() }
        ]
      );
    } else {
      navigation.goBack();
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <ArrowLeft color="#FFFFFF" size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#FFD700" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          <View style={styles.avatarSection}>
            <View style={styles.avatarWrapper}>
              {profileImageUri ? (
                <Image source={{ uri: getOptimizedImageUrl(profileImageUri) || profileImageUri }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarLetter}>{fullName ? fullName.charAt(0).toUpperCase() : 'U'}</Text>
                </View>
              )}
              {isUploadingImage && (
                <View style={styles.avatarLoadingOverlay}>
                  <ActivityIndicator color="#FFD700" />
                </View>
              )}
            </View>
            <TouchableOpacity onPress={handlePickImage} style={styles.changePhotoButton} disabled={isUploadingImage}>
              <Camera size={16} color="#000" />
              <Text style={styles.changePhotoText}>Change Photo</Text>
            </TouchableOpacity>
          </View>

          {errorMsg ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {successMsg ? (
            <View style={styles.successContainer}>
              <Text style={styles.successText}>{successMsg}</Text>
            </View>
          ) : null}

          <View style={styles.formSection}>
            <Text style={styles.sectionHeader}>Public Details</Text>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Full Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="Your full name"
                placeholderTextColor="#666"
                value={fullName}
                onChangeText={setFullName}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                placeholder="@username"
                placeholderTextColor="#666"
                autoCapitalize="none"
                value={username}
                onChangeText={setUsername}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Bio</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Tell us about yourself"
                placeholderTextColor="#666"
                multiline
                numberOfLines={3}
                value={bio}
                onChangeText={setBio}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Favorite Genre</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Synthwave"
                placeholderTextColor="#666"
                value={favoriteGenre}
                onChangeText={setFavoriteGenre}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Location / City</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. New York"
                placeholderTextColor="#666"
                value={location}
                onChangeText={setLocation}
              />
            </View>
          </View>

          <View style={styles.formSection}>
            <Text style={styles.sectionHeader}>Private Information</Text>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={[styles.input, styles.inputDisabled]}>
                <Text style={styles.disabledText}>{user?.email || 'N/A'}</Text>
                <Lock size={16} color="#666" />
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Phone Number</Text>
              <View style={[styles.input, styles.inputDisabled]}>
                <Text style={styles.disabledText}>{profile?.name ? (user as any)?.phone || 'Not setup' : 'Not setup'}</Text>
                <Lock size={16} color="#666" />
              </View>
            </View>

            <TouchableOpacity 
              style={styles.passwordLink} 
              onPress={() => navigation.navigate('ChangePassword')}
            >
              <Text style={styles.passwordLinkText}>Change Account Password</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={[styles.saveButton, (!isDirty || isSaving || isUploadingImage) && styles.saveButtonDisabled]} 
            onPress={handleSave}
            disabled={!isDirty || isSaving || isUploadingImage}
          >
            {isSaving ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
          
          <View style={{height: 40}} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    backgroundColor: '#0B0B0B',
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 20,
  },
  avatarSection: {
    alignItems: 'center',
    marginVertical: 24,
  },
  avatarWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
    marginBottom: 16,
    position: 'relative',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,215,0,0.1)',
  },
  avatarLetter: {
    color: '#FFD700',
    fontSize: 48,
    fontWeight: '800',
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFD700',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  changePhotoText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  errorContainer: {
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 0, 0, 0.3)',
  },
  errorText: {
    color: '#FF4444',
    fontSize: 14,
    textAlign: 'center',
  },
  successContainer: {
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 0, 0.3)',
  },
  successText: {
    color: '#44FF44',
    fontSize: 14,
    textAlign: 'center',
  },
  formSection: {
    backgroundColor: '#0B0B0B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222',
    padding: 16,
    marginBottom: 24,
  },
  sectionHeader: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
    marginLeft: 4,
  },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    color: '#FFF',
    fontSize: 16,
    paddingHorizontal: 16,
    height: 52,
  },
  textArea: {
    height: 100,
    paddingTop: 16,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    backgroundColor: '#111',
    borderColor: '#222',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disabledText: {
    color: '#666',
    fontSize: 16,
  },
  passwordLink: {
    marginTop: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  passwordLinkText: {
    color: '#FFD700',
    fontSize: 15,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#FFD700',
    borderRadius: 30,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#333',
    opacity: 0.8,
  },
  saveButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
  },
});
