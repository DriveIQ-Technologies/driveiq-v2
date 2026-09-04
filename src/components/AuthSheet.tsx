import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
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
import { auth } from '@/services/firebase';
import { friendlyGoogleSignInError } from '@/services/googleSignIn';
import { colors } from '@/theme/colors';

type Step = 'email' | 'password' | 'signup';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup';
  reason?: string | null;
  quietSkip?: boolean;
  onSkip?: () => void;
}

export function AuthSheet({
  visible,
  onClose,
  initialMode = 'signin',
  reason = null,
  quietSkip = false,
  onSkip,
}: Props) {
  const { login, loginWithApple, loginWithGoogle, signup, sendReset } = useAuth();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isNewUser, setIsNewUser] = useState(initialMode === 'signup');
  const [waitlistCode, setWaitlistCode] = useState('');
  const [showWaitlistCode, setShowWaitlistCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);

  React.useEffect(() => {
    if (visible) {
      setStep('email');
      setEmail('');
      setName('');
      setPassword('');
      setShowPassword(false);
      setWaitlistCode('');
      setShowWaitlistCode(false);
      setError(null);
      setNotice(null);
      setIsNewUser(initialMode === 'signup');
      trackScreen('auth_sheet', { mode: initialMode });
    }
  }, [visible, initialMode]);

  if (!visible) return null;

  const handleSkip = () => {
    track('signup_skipped', { source: 'quiet_skip' });
    (onSkip ?? onClose)();
  };

  const waitlistHints = () => ({
    waitlistEmail: undefined,
    claimToken: waitlistCode.trim() || undefined,
  });

  const continueWithEmail = () => {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    track('auth_email_entered', { mode: isNewUser ? 'signup' : 'signin' });
    if (isNewUser) {
      setStep('signup');
      setTimeout(() => nameRef.current?.focus(), 80);
    } else {
      setStep('password');
      setTimeout(() => passwordRef.current?.focus(), 80);
    }
  };

  const submitSignIn = async () => {
    setError(null);
    if (!password) {
      setError('Enter your password.');
      return;
    }
    try {
      setBusy(true);
      track('auth_submit_started', { mode: 'signin' });
      await login(email.trim(), password, waitlistHints());
      setPassword('');
      onClose();
    } catch (e) {
      track('auth_submit_failed', { mode: 'signin' });
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitSignUp = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Enter your name.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    try {
      setBusy(true);
      track('auth_submit_started', { mode: 'signup' });
      await signup(name.trim(), email.trim(), password, waitlistHints());
      setPassword('');
      onClose();
    } catch (e) {
      track('auth_submit_failed', { mode: 'signup' });
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitApple = async () => {
    setError(null);
    try {
      setBusy(true);
      track('auth_submit_started', { provider: 'apple' });
      await loginWithApple(waitlistHints());
      onClose();
      // If Hide My Email, surface a subtle in-app notice instead of a dialog
      const signedEmail = auth?.currentUser?.email ?? '';
      if (signedEmail.toLowerCase().includes('privaterelay.appleid.com')) {
        // handled silently — user can claim via Menu → Claim waitlist week
      }
    } catch (e) {
      track('auth_submit_failed', { provider: 'apple' });
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitGoogle = async () => {
    setError(null);
    try {
      setBusy(true);
      track('auth_submit_started', { provider: 'google' });
      await loginWithGoogle(waitlistHints());
      onClose();
    } catch (e) {
      track('auth_submit_failed', { provider: 'google' });
      setError(friendlyGoogleSignInError(e));
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    try {
      setBusy(true);
      await sendReset(email.trim());
      track('auth_reset_requested');
      setNotice('Reset email sent — check your inbox.');
    } catch (e) {
      track('auth_reset_failed');
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setStep('email');
    setError(null);
    setNotice(null);
    setPassword('');
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
            contentContainerStyle={{ paddingBottom: 28 }}
          >
            {/* Header row */}
            <View style={styles.topRow}>
              {step !== 'email' ? (
                <Pressable onPress={goBack} hitSlop={12} style={styles.backBtn}>
                  <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
                </Pressable>
              ) : (
                <View style={styles.brandBadge}>
                  <Ionicons name="navigate" size={22} color={colors.textOnPrimary} />
                </View>
              )}
              <Pressable
                onPress={quietSkip ? handleSkip : onClose}
                hitSlop={12}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            {/* Title */}
            <Text style={styles.title}>
              {step === 'email'
                ? isNewUser
                  ? 'Create a free account'
                  : 'Welcome back'
                : step === 'signup'
                  ? 'Create a free account'
                  : 'Sign in'}
            </Text>
            <Text style={styles.subtitle}>
              {reason
                ? reason
                : step === 'email'
                  ? isNewUser
                    ? 'Saves, alerts and 10 AI questions a day. No card needed.'
                    : 'Sign in to keep your saves, alerts and AI on this phone.'
                  : step === 'signup'
                    ? `Creating a free account for ${email.trim()}`
                    : `Signing in as ${email.trim()}`}
            </Text>

            <View style={styles.gateNote}>
              <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
              <Text style={styles.gateNoteText}>
                Free covers the live map, saves, disruption alerts and 10 AI questions a day.
                Premium adds unlimited AI, all-day flights and every saved station.
              </Text>
            </View>

            {/* ── STEP 1: email + social ── */}
            {step === 'email' ? (
              <>
                {Platform.OS === 'ios' ? (
                  <Pressable
                    onPress={submitApple}
                    disabled={busy}
                    style={[styles.socialBtn, busy && styles.btnDisabled]}
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.textPrimary} size="small" />
                    ) : (
                      <>
                        <Ionicons name="logo-apple" size={18} color={colors.textPrimary} />
                        <Text style={styles.socialText}>Continue with Apple</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={submitGoogle}
                  disabled={busy}
                  style={[styles.socialBtn, styles.socialBtnSpaced, busy && styles.btnDisabled]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.textPrimary} size="small" />
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={18} color={colors.textPrimary} />
                      <Text style={styles.socialText}>Continue with Google</Text>
                    </>
                  )}
                </Pressable>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or use email</Text>
                  <View style={styles.dividerLine} />
                </View>

                <InputField
                  icon="mail-outline"
                  placeholder="Email address"
                  value={email}
                  onChangeText={(t) => { setEmail(t); setError(null); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoFocus
                  returnKeyType="next"
                  onSubmitEditing={continueWithEmail}
                />

                <View style={styles.modeRow}>
                  <Pressable
                    onPress={() => { setIsNewUser(false); setError(null); }}
                    style={[styles.modeBtn, !isNewUser && styles.modeBtnActive]}
                  >
                    <Text style={[styles.modeBtnText, !isNewUser && styles.modeBtnTextActive]}>
                      Sign in
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { setIsNewUser(true); setError(null); }}
                    style={[styles.modeBtn, isNewUser && styles.modeBtnActive]}
                  >
                    <Text style={[styles.modeBtnText, isNewUser && styles.modeBtnTextActive]}>
                      Create free account
                    </Text>
                  </Pressable>
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  onPress={continueWithEmail}
                  disabled={busy}
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                >
                  <Text style={styles.primaryText}>Continue</Text>
                  <Ionicons
                    name="arrow-forward"
                    size={18}
                    color={colors.textOnPrimary}
                    style={{ marginLeft: 6 }}
                  />
                </Pressable>

                {quietSkip ? (
                  <Pressable onPress={handleSkip} hitSlop={8} style={styles.quietSkip}>
                    <Text style={styles.quietSkipText}>Have a look around first</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            {/* ── STEP 2: sign in ── */}
            {step === 'password' ? (
              <>
                <Pressable onPress={goBack} style={styles.emailChip}>
                  <Ionicons name="mail-outline" size={15} color={colors.primary} />
                  <Text style={styles.emailChipText}>{email.trim()}</Text>
                  <Ionicons name="pencil-outline" size={13} color={colors.textSecondary} />
                </Pressable>

                <PasswordField
                  ref={passwordRef}
                  placeholder="Password"
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(null); }}
                  show={showPassword}
                  onToggle={() => setShowPassword((s) => !s)}
                  onSubmitEditing={submitSignIn}
                />

                <Pressable
                  onPress={() => setShowWaitlistCode((v) => !v)}
                  style={styles.optionalToggle}
                >
                  <Ionicons
                    name={showWaitlistCode ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.optionalToggleText}>Have a waitlist claim code?</Text>
                </Pressable>
                {showWaitlistCode ? (
                  <InputField
                    icon="ticket-outline"
                    placeholder="Claim code"
                    value={waitlistCode}
                    onChangeText={(t) => { setWaitlistCode(t); setError(null); }}
                    autoCapitalize="characters"
                  />
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}
                {notice ? <Text style={styles.notice}>{notice}</Text> : null}

                <Pressable
                  onPress={submitSignIn}
                  disabled={busy}
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.textOnPrimary} />
                  ) : (
                    <Text style={styles.primaryText}>Sign in</Text>
                  )}
                </Pressable>

                <Pressable onPress={onForgot} disabled={busy} style={styles.forgotBtn}>
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </Pressable>
              </>
            ) : null}

            {/* ── STEP 3: sign up ── */}
            {step === 'signup' ? (
              <>
                <Pressable onPress={goBack} style={styles.emailChip}>
                  <Ionicons name="mail-outline" size={15} color={colors.primary} />
                  <Text style={styles.emailChipText}>{email.trim()}</Text>
                  <Ionicons name="pencil-outline" size={13} color={colors.textSecondary} />
                </Pressable>

                <InputField
                  ref={nameRef}
                  icon="person-outline"
                  placeholder="Full name"
                  value={name}
                  onChangeText={(t) => { setName(t); setError(null); }}
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />

                <PasswordField
                  ref={passwordRef}
                  placeholder="Password (min 8 characters)"
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(null); }}
                  show={showPassword}
                  onToggle={() => setShowPassword((s) => !s)}
                  onSubmitEditing={submitSignUp}
                />

                <Pressable
                  onPress={() => setShowWaitlistCode((v) => !v)}
                  style={styles.optionalToggle}
                >
                  <Ionicons
                    name={showWaitlistCode ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.optionalToggleText}>Have a waitlist claim code?</Text>
                </Pressable>
                {showWaitlistCode ? (
                  <InputField
                    icon="ticket-outline"
                    placeholder="Claim code"
                    value={waitlistCode}
                    onChangeText={(t) => { setWaitlistCode(t); setError(null); }}
                    autoCapitalize="characters"
                  />
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}
                {notice ? <Text style={styles.notice}>{notice}</Text> : null}

                <Pressable
                  onPress={submitSignUp}
                  disabled={busy}
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.textOnPrimary} />
                  ) : (
                    <Text style={styles.primaryText}>Create free account</Text>
                  )}
                </Pressable>

                <Text style={styles.termsText}>
                  By creating an account you agree to our terms and privacy policy.
                </Text>
              </>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SheetOverlay>
  );
}

/* ─── Sub-components ─── */

const InputField = React.forwardRef<
  TextInput,
  { icon: React.ComponentProps<typeof Ionicons>['name'] } & React.ComponentProps<typeof TextInput>
>(({ icon, ...props }, ref) => (
  <View style={styles.inputWrapper}>
    <Ionicons name={icon} size={18} color={colors.primary} style={styles.inputIcon} />
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textSecondary}
      style={styles.input}
      {...props}
    />
  </View>
));
InputField.displayName = 'InputField';

const PasswordField = React.forwardRef<
  TextInput,
  {
    placeholder?: string;
    value: string;
    onChangeText: (t: string) => void;
    show: boolean;
    onToggle: () => void;
    onSubmitEditing?: () => void;
  }
>(({ placeholder, value, onChangeText, show, onToggle, onSubmitEditing }, ref) => (
  <View style={styles.inputWrapper}>
    <Ionicons
      name="lock-closed-outline"
      size={18}
      color={colors.primary}
      style={styles.inputIcon}
    />
    <TextInput
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      secureTextEntry={!show}
      placeholderTextColor={colors.textSecondary}
      style={styles.input}
      onSubmitEditing={onSubmitEditing}
      returnKeyType="done"
    />
    <Pressable onPress={onToggle} hitSlop={10} style={styles.eyeBtn}>
      <Ionicons
        name={show ? 'eye-off-outline' : 'eye-outline'}
        size={18}
        color={colors.textSecondary}
      />
    </Pressable>
  </View>
));
PasswordField.displayName = 'PasswordField';

/* ─── Styles ─── */
const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 8,
    maxHeight: '90%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  brandBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 5,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  gateNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    marginBottom: 18,
  },
  gateNoteText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    fontWeight: '500',
  },
  socialBtn: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    minHeight: 52,
  },
  socialBtnSpaced: {
    marginTop: 10,
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
    marginVertical: 18,
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
  modeRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    padding: 4,
    marginTop: 12,
    marginBottom: 18,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  modeBtnTextActive: {
    color: colors.primary,
  },
  emailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  emailChipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
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
  optionalToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    marginTop: -4,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  optionalToggleText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  error: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  notice: {
    color: colors.family,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.65 },
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
  termsText: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 14,
    lineHeight: 16,
  },
  quietSkip: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  quietSkipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
});
