import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Lock, Eye, EyeOff } from 'lucide-react-native';
import { userService } from '../services/userService';
import { normalizeApiError } from '../services/api';

export default function ChangePasswordScreen() {
  const navigation = useNavigation();
  
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isFormValid = oldPassword.length > 0 && newPassword.length >= 6 && confirmPassword.length >= 6;

  const handleSave = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    
    if (newPassword !== confirmPassword) {
      setErrorMsg('New passwords do not match');
      return;
    }
    
    if (newPassword.length < 6) {
      setErrorMsg('New password must be at least 6 characters');
      return;
    }

    try {
      setIsLoading(true);
      await userService.updatePassword({
        oldPassword,
        newPassword
      });
      setSuccessMsg('Password updated successfully');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      
      // Auto go back after short delay
      setTimeout(() => {
        navigation.goBack();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(normalizeApiError(err).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Password</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.iconContainer}>
            <View style={styles.iconCircle}>
              <Lock color="#FFD700" size={40} />
            </View>
            <Text style={styles.subtext}>Create a new, strong password to keep your account secure.</Text>
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

          <View style={styles.formGroup}>
            <Text style={styles.label}>Old Password</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Enter current password"
                placeholderTextColor="#666"
                secureTextEntry={!showOldPassword}
                value={oldPassword}
                onChangeText={setOldPassword}
              />
              <TouchableOpacity onPress={() => setShowOldPassword(!showOldPassword)} style={styles.eyeIcon}>
                {showOldPassword ? <EyeOff color="#999" size={20} /> : <Eye color="#999" size={20} />}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>New Password</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Enter new password (min. 6 chars)"
                placeholderTextColor="#666"
                secureTextEntry={!showNewPassword}
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)} style={styles.eyeIcon}>
                {showNewPassword ? <EyeOff color="#999" size={20} /> : <Eye color="#999" size={20} />}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Confirm New Password</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Re-enter new password"
                placeholderTextColor="#666"
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeIcon}>
                {showConfirmPassword ? <EyeOff color="#999" size={20} /> : <Eye color="#999" size={20} />}
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity 
            style={[styles.saveButton, (!isFormValid || isLoading) && styles.saveButtonDisabled]} 
            onPress={handleSave}
            disabled={!isFormValid || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.saveButtonText}>Update Password</Text>
            )}
          </TouchableOpacity>
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
    borderBottomColor: '#333',
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 24,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  subtext: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  errorContainer: {
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
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
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 0, 0.3)',
  },
  successText: {
    color: '#44FF44',
    fontSize: 14,
    textAlign: 'center',
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    height: 56,
  },
  input: {
    flex: 1,
    color: '#FFF',
    fontSize: 16,
    paddingHorizontal: 16,
    height: '100%',
  },
  eyeIcon: {
    padding: 16,
  },
  saveButton: {
    backgroundColor: '#FFD700',
    borderRadius: 30,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  saveButtonDisabled: {
    backgroundColor: '#666',
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
