import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { friendlyAuthError, useAuth } from '@/providers/AuthProvider';
import { track, trackScreen } from '@/services/analytics';
import { showDialog } from '@/services/dialog';
import { auth } from '@/services/firebase';
import { friendlyGoogleSignInError } from '@/services/googleSignIn';
import { colors } from '@/theme/colors';

type Mode = 'signin' | 'signup';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Which form to show first. */
  initialMode?: Mode;
  /**
   * Shown when auth was opened from a gated action (save / notify / …).
   * Doc task 09: explain that saves and alerts need an account to live in.
   */
  reason?: string | null;
  /**
   * Quiet skip under the primary button. Task 09: "Have a look around first"
   * as small text, not a competing button. Used after the walkthrough, not
   * on the first-action prompt.
   */
  quietSkip?: boolean;
  onSkip?: () => void;
}

/**
 * Email/password authentication sheet. Toggles between Sign in and Create
 * account, with inline validation, friendly error messages, a show/hide
 * password control, and a "forgot password" reset flow. Styled to match the
 * DriveIQ surface theme (no external gradient dependency).
 */
export function AuthSheet({
  visible,
  onClose,
  initialMode = 'signin',
  reason = null,
  quietSkip = false,
  onSkip,
}: Props) {
  const { login, loginWithApple, loginWithGoogle, signup, sendReset } = useAuth();
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

  const handleSkip = () => {
    track('signup_skipped', { source: 'quiet_skip' });
    (onSkip ?? onClose)();
  };

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
    if (isSignup && password.length < 8) {
      setError('Password should be at least 8 characters.');
      return;
    }
    try {
      setBusy(true);
      track('auth_submit_started', { mode });
      if (isSignup) {
        await signup(name, email.trim(), password);
        setPassword('');
        onClose();
        showDialog(
          'Welcome to DriveIQ',
          `Hi ${name.trim().split(' ')[0] || 'there'}. Your account is ready. I have sent a verification email to ${email.trim()}. Tap the link so we can keep your saves and alerts tied to you. Then open Notifications if you want pings for roads, trains, saved events and flights.`,
        );
      } else {
        await login(email.trim(), password);
        setPassword('');
        onClose();
      }
    } catch (e) {
      track('auth_submit_failed', { mode });
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitApple = async () => {
    setError(null);
    setNotice(null);
    try {
      setBusy(true);
      track('auth_submit_started', { mode, provider: 'apple' });
      await loginWithApple();
      onClose();
      const signedEmail = auth?.currentUser?.email ?? '';
      if (signedEmail.toLowerCase().includes('privaterelay.appleid.com')) {
        showDialog(
          'Claim your waitlist week',
          'You signed in with Apple Hide My Email. To unlock your waitlist week, open Menu > Claim waitlist week, then enter your claim code or your waitlist email.',
        );
      }
    } catch (e) {
      track('auth_submit_failed', { mode, provider: 'apple' });
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitGoogle = async () => {
    setError(null);
    setNotice(null);
    try {
      setBusy(true);
      track('auth_submit_started', { mode, provider: 'google' });
      await loginWithGoogle();
      onClose();
    } catch (e) {
      track('auth_submit_failed', { mode, provider: 'google' });
      setError(friendlyGoogleSignInError(e));
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
    <SheetOverlay onRequestClose={quietSkip ? handleSkip : onClose} level={8}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <View style={styles.topRow}>
              <View style={styles.brandBadge}>
                <Ionicons name="navigate" size={24} color={colors.textOnPrimary} />
              </View>
              <Pressable
                onPress={quietSkip ? handleSkip : onClose}
                hitSlop={12}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.title}>
              {isSignup ? 'Create your account' : 'Welcome back'}
            </Text>
            <Text style={styles.subtitle}>
              {reason
                ? reason
                : isSignup
                  ? 'Welcome to DriveIQ. Save events, get alerts, and ask the AI, all tied to your account.'
                  : 'Sign in to sync your saved events and alert preferences.'}
            </Text>

            {reason ? (
              <View style={styles.gateNote}>
                <Ionicons name="checkmark-circle" size={15} color={colors.primary} />
                <Text style={styles.gateNoteText}>
                  A free account covers saves, alerts and the AI event guide.
                  Premium adds unlimited AI, full-day flight boards and every
                  saved station.
                </Text>
              </View>
            ) : null}

            {Platform.OS === 'ios' ? (
              <Pressable
                onPress={submitApple}
                disabled={busy}
                style={[styles.socialBtn, styles.appleBtn, busy && styles.btnDisabled]}
              >
                <Ionicons name="logo-apple" size={18} color={colors.textPrimary} />
                <Text style={styles.socialText}>Continue with Apple</Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={submitGoogle}
              disabled={busy}
              style={[styles.socialBtn, styles.googleBtn, busy && styles.btnDisabled]}
            >
              <Ionicons name="logo-google" size={18} color={colors.textPrimary} />
              <Text style={styles.socialText}>Continue with Google</Text>
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with email</Text>
              <View style={styles.dividerLine} />
            </View>

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
                placeholder={isSignup ? 'Password (min 8 characters)' : 'Password'}
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
                  {isSignup ? 'Create free account' : 'Sign in'}
                </Text>
              )}
            </Pressable>

            {!isSignup ? (
              <Pressable onPress={onForgot} disabled={busy} style={styles.forgotBtn}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            ) : null}

            {quietSkip ? (
              <Pressable
                onPress={handleSkip}
                hitSlop={8}
                style={styles.quietSkip}
                accessibilityRole="button"
                accessibilityLabel="Have a look around first"
              >
                <Text style={styles.quietSkipText}>Have a look around first</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SheetOverlay>
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
  flex: { flex: 1, justifyContent: 'flex-end' },
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
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
  gateNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    marginBottom: 16,
  },
  gateNoteText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    fontWeight: '500',
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
  appleBtn: {
    marginBottom: 10,
  },
  googleBtn: {
    marginBottom: 14,
  },
  socialBtn: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  socialText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
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
  quietSkip: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  quietSkipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
});
