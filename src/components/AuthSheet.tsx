import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import {
  friendlyAuthError,
  getLastAuthFailure,
  isUserCancelledAuth,
  useAuth,
} from '@/providers/AuthProvider';
import { track, trackScreen } from '@/services/analytics';
import { auth } from '@/services/firebase';
import {
  friendlyGoogleSignInError,
  isGoogleSignInConfigured,
} from '@/services/googleSignIn';
import { colors } from '@/theme/colors';

const TERMS_URL = 'https://driveiq.app/terms';
const PRIVACY_URL = 'https://driveiq.app/privacy';

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
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const passwordRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isNewUser, setIsNewUser] = useState(initialMode === 'signup');
  const [waitlistCode, setWaitlistCode] = useState('');
  const [showWaitlistCode, setShowWaitlistCode] = useState(false);
  /**
   * Which action is in flight — not just "something is". A single boolean put
   * a spinner on BOTH social buttons at once, so tapping Apple made it look
   * like Google was working too. Every button still disables while any action
   * runs (two concurrent sign-ins would be worse), but only the one you
   * actually tapped shows the spinner.
   */
  const [pending, setPending] = useState<'apple' | 'google' | 'email' | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
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

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (!visible) return null;

  const handleSkip = () => {
    track('signup_skipped', { source: 'quiet_skip' });
    (onSkip ?? onClose)();
  };

  const waitlistHints = () => ({
    waitlistEmail: undefined,
    claimToken: waitlistCode.trim() || undefined,
  });

  const scrollToActions = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  };

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
      setPending('email');
      track('auth_submit_started', { mode: 'signin' });
      await login(email.trim(), password, waitlistHints());
      setPassword('');
      onClose();
    } catch (e) {
      track('auth_submit_failed', { mode: 'signin' });
      setError(friendlyAuthError(e));
    } finally {
      setPending(null);
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
      setPending('email');
      track('auth_submit_started', { mode: 'signup' });
      await signup(name.trim(), email.trim(), password, waitlistHints());
      setPassword('');
      onClose();
    } catch (e) {
      track('auth_submit_failed', { mode: 'signup' });
      setError(friendlyAuthError(e));
    } finally {
      setPending(null);
    }
  };

  /**
   * In a dev build, append the stage and raw code to whatever friendly message
   * we show. The console is easy to miss and LogBox truncates; the sheet is
   * right in front of you. Production copy is untouched.
   */
  const withDevDetail = (message: string): string => {
    if (!__DEV__) return message;
    const last = getLastAuthFailure();
    if (!last) return message;
    return `${message}\n\n[dev] stage=${last.stage} code=${last.code || 'none'}\n${last.message}`;
  };

  const submitApple = async () => {
    setError(null);
    Keyboard.dismiss();
    try {
      setPending('apple');
      track('auth_submit_started', { provider: 'apple' });
      await loginWithApple(waitlistHints());
      onClose();
    } catch (e) {
      // A deliberate dismiss of the provider sheet is not a failure: drop the
      // spinner and leave the form as it was, with no red banner.
      if (isUserCancelledAuth(e)) return;
      track('auth_submit_failed', { provider: 'apple' });
      setError(withDevDetail(friendlyAuthError(e)));
    } finally {
      setPending(null);
    }
  };

  const submitGoogle = async () => {
    setError(null);
    Keyboard.dismiss();
    if (!isGoogleSignInConfigured()) {
      setError('Google sign-in needs the next app update. Use email for now.');
      return;
    }
    try {
      setPending('google');
      track('auth_submit_started', { provider: 'google' });
      await loginWithGoogle(waitlistHints());
      onClose();
    } catch (e) {
      // A deliberate dismiss of the provider sheet is not a failure: drop the
      // spinner and leave the form as it was, with no red banner.
      if (isUserCancelledAuth(e)) return;
      track('auth_submit_failed', { provider: 'google' });
      setError(withDevDetail(friendlyGoogleSignInError(e)));
    } finally {
      setPending(null);
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
      setPending('email');
      await sendReset(email.trim());
      track('auth_reset_requested');
      setNotice('Reset email sent — check your inbox.');
    } catch (e) {
      track('auth_reset_failed');
      setError(friendlyAuthError(e));
    } finally {
      setPending(null);
    }
  };

  const goBack = () => {
    setStep('email');
    setError(null);
    setNotice(null);
    setPassword('');
    Keyboard.dismiss();
  };

  const primaryLabel =
    step === 'email' ? 'Continue' : step === 'signup' ? 'Create free account' : 'Sign in';

  const onPrimary = () => {
    if (step === 'email') continueWithEmail();
    else if (step === 'signup') void submitSignUp();
    else void submitSignIn();
  };

  const footerPad = Math.max(insets.bottom, 12) + (keyboardOpen ? 8 : 4);

  return (
    <SheetOverlay onRequestClose={quietSkip ? handleSkip : onClose} level={8}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            onContentSizeChange={() => {
              if (keyboardOpen) scrollToActions();
            }}
          >
            <View style={styles.topRow}>
              {step !== 'email' ? (
                <Pressable onPress={goBack} hitSlop={12} style={styles.backBtn}>
                  <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
                </Pressable>
              ) : (
                <View style={styles.brandBadge}>
                  <Ionicons name="navigate" size={20} color={colors.textOnPrimary} />
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

            <Text style={styles.title}>
              {step === 'email'
                ? isNewUser
                  ? 'Create a free account'
                  : 'Welcome back'
                : step === 'signup'
                  ? 'Almost there'
                  : 'Enter password'}
            </Text>
            <Text style={styles.subtitle}>
              {reason
                ? reason
                : step === 'email'
                  ? isNewUser
                    ? 'Saves, alerts and 10 AI questions a day. No card needed.'
                    : 'Keep your saves, alerts and AI on this phone.'
                  : step === 'signup'
                    ? `Creating an account for ${email.trim()}`
                    : `Signing in as ${email.trim()}`}
            </Text>

            {step === 'email' ? (
              <>
                {Platform.OS === 'ios' ? (
                  <Pressable
                    onPress={submitApple}
                    disabled={busy}
                    style={[styles.socialBtn, busy && styles.btnDisabled]}
                  >
                    {pending === 'apple' ? (
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
                  style={[
                    styles.socialBtn,
                    Platform.OS === 'ios' && styles.socialBtnSpaced,
                    busy && styles.btnDisabled,
                  ]}
                >
                  {pending === 'google' ? (
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
                  <Text style={styles.dividerText}>or email</Text>
                  <View style={styles.dividerLine} />
                </View>

                <InputField
                  icon="mail-outline"
                  placeholder="Email address"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setError(null);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onFocus={scrollToActions}
                  onSubmitEditing={continueWithEmail}
                />
              </>
            ) : null}

            {step === 'password' ? (
              <>
                <Pressable onPress={goBack} style={styles.emailChip}>
                  <Ionicons name="mail-outline" size={15} color={colors.primary} />
                  <Text style={styles.emailChipText} numberOfLines={1}>
                    {email.trim()}
                  </Text>
                  <Ionicons name="pencil-outline" size={13} color={colors.textSecondary} />
                </Pressable>

                <PasswordField
                  ref={passwordRef}
                  placeholder="Password"
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setError(null);
                  }}
                  show={showPassword}
                  onToggle={() => setShowPassword((s) => !s)}
                  onFocus={scrollToActions}
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
                    onChangeText={(t) => {
                      setWaitlistCode(t);
                      setError(null);
                    }}
                    autoCapitalize="characters"
                    onFocus={scrollToActions}
                  />
                ) : null}
              </>
            ) : null}

            {step === 'signup' ? (
              <>
                <Pressable onPress={goBack} style={styles.emailChip}>
                  <Ionicons name="mail-outline" size={15} color={colors.primary} />
                  <Text style={styles.emailChipText} numberOfLines={1}>
                    {email.trim()}
                  </Text>
                  <Ionicons name="pencil-outline" size={13} color={colors.textSecondary} />
                </Pressable>

                <InputField
                  ref={nameRef}
                  icon="person-outline"
                  placeholder="Full name"
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    setError(null);
                  }}
                  autoCapitalize="words"
                  returnKeyType="next"
                  onFocus={scrollToActions}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />

                <PasswordField
                  ref={passwordRef}
                  placeholder="Password (min 8 characters)"
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setError(null);
                  }}
                  show={showPassword}
                  onToggle={() => setShowPassword((s) => !s)}
                  onFocus={scrollToActions}
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
                    onChangeText={(t) => {
                      setWaitlistCode(t);
                      setError(null);
                    }}
                    autoCapitalize="characters"
                    onFocus={scrollToActions}
                  />
                ) : null}

                <Text style={styles.termsText}>
                  By creating an account you agree to our{' '}
                  <Text
                    style={styles.termsLink}
                    onPress={() => void Linking.openURL(TERMS_URL).catch(() => undefined)}
                  >
                    Terms of Use
                  </Text>
                  {' '}and{' '}
                  <Text
                    style={styles.termsLink}
                    onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => undefined)}
                  >
                    Privacy Policy
                  </Text>
                  .
                </Text>
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            {step === 'password' ? (
              <Pressable onPress={onForgot} disabled={busy} style={styles.forgotBtn}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: footerPad }]}>
            <Pressable
              onPress={onPrimary}
              disabled={busy}
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
            >
              {pending === 'email' && step !== 'email' ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <>
                  <Text style={styles.primaryText}>{primaryLabel}</Text>
                  {step === 'email' ? (
                    <Ionicons
                      name="arrow-forward"
                      size={18}
                      color={colors.textOnPrimary}
                      style={{ marginLeft: 6 }}
                    />
                  ) : null}
                </>
              )}
            </Pressable>

            {step === 'email' ? (
              <Pressable
                onPress={() => {
                  setIsNewUser((v) => !v);
                  setError(null);
                }}
                hitSlop={8}
                style={styles.switchMode}
              >
                <Text style={styles.switchModeText}>
                  {isNewUser ? 'Already have an account? ' : 'New here? '}
                  <Text style={styles.switchModeLink}>
                    {isNewUser ? 'Sign in' : 'Create free account'}
                  </Text>
                </Text>
              </Pressable>
            ) : null}

            {quietSkip && step === 'email' ? (
              <Pressable onPress={handleSkip} hitSlop={8} style={styles.quietSkip}>
                <Text style={styles.quietSkipText}>Have a look around first</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SheetOverlay>
  );
}

const InputField = React.forwardRef<
  TextInput,
  {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    onFocus?: () => void;
  } & React.ComponentProps<typeof TextInput>
>(({ icon, onFocus, ...props }, ref) => (
  <View style={styles.inputWrapper}>
    <Ionicons name={icon} size={18} color={colors.primary} style={styles.inputIcon} />
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textSecondary}
      style={styles.input}
      onFocus={onFocus}
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
    onFocus?: () => void;
    onSubmitEditing?: () => void;
  }
>(({ placeholder, value, onChangeText, show, onToggle, onFocus, onSubmitEditing }, ref) => (
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
      onFocus={onFocus}
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

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 10,
    marginBottom: 8,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingBottom: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  brandBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 18,
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
    paddingVertical: 14,
    minHeight: 50,
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
    marginVertical: 16,
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
  emailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
    alignSelf: 'stretch',
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
    paddingVertical: 14,
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
    marginTop: -2,
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
    marginTop: 4,
    marginBottom: 4,
  },
  notice: {
    color: colors.family,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 4,
  },
  forgotBtn: { alignSelf: 'flex-start', paddingVertical: 8 },
  forgotText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  termsText: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
    marginTop: 4,
  },
  termsLink: {
    color: colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 22,
    paddingTop: 12,
    backgroundColor: colors.surface,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minHeight: 52,
  },
  btnDisabled: { opacity: 0.65 },
  primaryText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  switchMode: {
    alignItems: 'center',
    paddingTop: 14,
  },
  switchModeText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  switchModeLink: {
    color: colors.primary,
    fontWeight: '700',
  },
  quietSkip: {
    alignItems: 'center',
    paddingTop: 10,
  },
  quietSkipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
});
