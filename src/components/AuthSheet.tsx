import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { friendlyAuthError, useAuth } from '@/providers/AuthProvider';
import { track, trackScreen } from '@/services/analytics';
import { colors } from '@/theme/colors';

type Mode = 'signin' | 'signup';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Which form to show first. */
  initialMode?: Mode;
}

/**
 * Email/password authentication sheet. Toggles between Sign in and Create
 * account, with inline validation, friendly error messages, a show/hide
 * password control, and a "forgot password" reset flow. Styled to match the
 * DriveIQ surface theme (no external gradient dependency).
 */
export function AuthSheet({ visible, onClose, initialMode = 'signin' }: Props) {
  const { login, signup, sendReset } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Reset transient state whenever the sheet (re)opens.
  React.useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setError(null);
      setNotice(null);
      setBusy(false);
      trackScreen('auth_sheet', { mode: initialMode });
    }
  }, [visible, initialMode]);

  if (!visible) return null;

  const isSignup = mode === 'signup';

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }
    if (isSignup && !name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (isSignup && password.length < 6) {
      setError('Password should be at least 6 characters.');
      return;
    }
    try {
      setBusy(true);
      track('auth_submit_started', { mode });
      if (isSignup) {
        await signup(name, email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
      // Success — onAuthStateChanged updates the app; close the sheet.
      setPassword('');
      onClose();
    } catch (e) {
      track('auth_submit_failed', { mode });
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError('Enter your email above, then tap "Forgot password".');
      return;
    }
    try {
      setBusy(true);
      await sendReset(email.trim());
      track('auth_reset_requested');
      setNotice('Password reset email sent. Check your inbox.');
    } catch (e) {
      track('auth_reset_failed');
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <View style={styles.brandBadge}>
              <Ionicons name="navigate" size={24} color={colors.textOnPrimary} />
            </View>
            <Text style={styles.title}>
              {isSignup ? 'Create your account' : 'Welcome back'}
            </Text>
            <Text style={styles.subtitle}>
              {isSignup
                ? 'Save events, sync preferences, and get personalised alerts.'
                : 'Sign in to sync your saved events and alert preferences.'}
            </Text>

            {/* Segmented toggle */}
            <View style={styles.segment}>
              {(['signin', 'signup'] as Mode[]).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => {
                    setMode(m);
                    setError(null);
                    setNotice(null);
                    track('auth_mode_switched', { mode: m });
                  }}
                  style={[styles.segmentBtn, mode === m && styles.segmentBtnActive]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      mode === m && styles.segmentTextActive,
                    ]}
                  >
                    {m === 'signin' ? 'Sign in' : 'Create account'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {isSignup ? (
              <Field
                icon="person-outline"
                placeholder="Full name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            ) : null}

            <Field
              icon="mail-outline"
              placeholder="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.inputWrapper}>
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={colors.primary}
                style={styles.inputIcon}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={isSignup ? 'Password (min 6 characters)' : 'Password'}
                secureTextEntry={!showPassword}
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
              <Pressable
                onPress={() => setShowPassword((s) => !s)}
                hitSlop={10}
                style={styles.eyeBtn}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Pressable
              onPress={submit}
              disabled={busy}
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
            >
              {busy ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.primaryText}>
                  {isSignup ? 'Create account' : 'Sign in'}
                </Text>
              )}
            </Pressable>

            {!isSignup ? (
              <Pressable onPress={onForgot} disabled={busy} style={styles.forgotBtn}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  icon,
  ...input
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.inputWrapper}>
      <Ionicons name={icon} size={20} color={colors.primary} style={styles.inputIcon} />
      <TextInput
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
        {...input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(14, 42, 58, 0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 8,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  brandBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 18,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    padding: 4,
    marginBottom: 18,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  segmentTextActive: { color: colors.primary },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    marginBottom: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    paddingVertical: 15,
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  eyeBtn: { padding: 6 },
  error: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    marginTop: -2,
  },
  notice: {
    color: colors.family,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    marginTop: -2,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.7 },
  primaryText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  forgotBtn: { alignItems: 'center', paddingVertical: 14 },
  forgotText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
