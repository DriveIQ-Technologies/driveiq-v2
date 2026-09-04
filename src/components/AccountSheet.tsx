import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
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
import { showDialog } from '@/services/dialog';
import { friendlyAuthError, useAuth } from '@/providers/AuthProvider';
import { track, trackScreen } from '@/services/analytics';
import {
  claimWaitlistByToken,
  friendlyWaitlistCodeRequestError,
  requestWaitlistCodeByEmail,
  friendlyWaitlistClaimError,
  type WaitlistClaimResponse,
} from '@/services/waitlist';
import { presentPremiumUnlock } from '@/services/subscription';
import { colors } from '@/theme/colors';


/** Which sub-form the account sheet opens to. */
export type AccountSection = 'profile' | 'email' | 'password' | 'waitlist';

interface Props {
  visible: boolean;
  section: AccountSection;
  onClose: () => void;
}

/**
 * Signed-in account management: edit display name, change email (re-auth),
 * and change password (re-auth). One sheet, three modes, driven by the
 * `section` the sidebar row requested.
 */
export function AccountSheet({ visible, section, onClose }: Props) {
  const { user, updateDisplayName, updateUserEmail, changePassword } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [waitlistInput, setWaitlistInput] = useState('');
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(user?.displayName ?? '');
      setEmail(user?.email ?? '');
      setCurrentPassword('');
      setNewPassword('');
      setWaitlistInput('');
      setWaitlistEmail(user?.email ?? '');
      setError(null);
      setNotice(null);
      setBusy(false);
      trackScreen('account_sheet', { section });
    }
  }, [visible, section, user]);

  if (!visible) return null;

  const titles: Record<AccountSection, string> = {
    profile: 'Edit profile',
    email: 'Change email',
    password: 'Change password',
    waitlist: 'Claim waitlist week',
  };

  const finishWaitlistClaim = (result: WaitlistClaimResponse) => {
    if (result.ok && (result.status === 'granted' || result.status === 'already_active')) {
      onClose();
      if (result.status === 'granted') {
        presentPremiumUnlock({ kind: 'waitlist', trialStarted: true });
      } else {
        showDialog('Waitlist week active', result.message);
      }
      return;
    }
    setError(result.message);
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    try {
      setBusy(true);
      if (section === 'profile') {
        if (!name.trim()) {
          setError('Please enter a name.');
          return;
        }
        await updateDisplayName(name);
        track('account_profile_save_succeeded');
        done('Profile updated.');
      } else if (section === 'waitlist') {
        if (!waitlistInput.trim()) {
          setError('Enter your claim code.');
          return;
        }
        track('waitlist_claim_started', { method: 'token' });
        const result = await claimWaitlistByToken(waitlistInput);
        track('waitlist_claim_finished', { status: result.status, ok: result.ok });
        finishWaitlistClaim(result);
      } else if (section === 'email') {
        if (!email.trim() || !currentPassword) {
          setError('Enter your new email and current password.');
          return;
        }
        await updateUserEmail(currentPassword, email);
        track('account_email_save_succeeded');
        done('Email updated.');
      } else {
        if (!currentPassword || !newPassword) {
          setError('Enter your current and new password.');
          return;
        }
        if (newPassword.length < 8) {
          setError('New password should be at least 8 characters.');
          return;
        }
        await changePassword(currentPassword, newPassword);
        track('account_password_save_succeeded');
        done('Password changed.');
      }
    } catch (e) {
      track('account_save_failed', { section });
      setError(
        section === 'waitlist' ? friendlyWaitlistClaimError(e) : friendlyAuthError(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const requestCode = async () => {
    setError(null);
    setNotice(null);
    if (!waitlistEmail.trim()) {
      setError('Enter your waitlist email first.');
      return;
    }
    try {
      setBusy(true);
      track('waitlist_code_request_started');
      const result = await requestWaitlistCodeByEmail(waitlistEmail);
      track('waitlist_code_request_finished', { ok: result.ok, status: result.status });
      if (!result.ok && result.status === 'invalid_email') {
        setError(result.message);
        return;
      }
      setNotice(result.message);
    } catch (e) {
      track('waitlist_code_request_failed');
      setError(friendlyWaitlistCodeRequestError(e));
    } finally {
      setBusy(false);
    }
  };

  const done = (msg: string) => {
    onClose();
    showDialog('Done', msg);
  };

  return (
    <SheetOverlay onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <Text style={styles.title}>{titles[section]}</Text>

            {section === 'waitlist' ? (
              <>
                <Text style={styles.help}>
              Sign up with your waitlist email for automatic Premium. If this
              account uses a different email, enter the waitlist address below
              to resend your code, or paste the claim code from the email.
            </Text>
                <Field
                  icon="mail-outline"
                  placeholder="Waitlist email"
                  value={waitlistEmail}
                  onChangeText={setWaitlistEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Pressable
                  onPress={requestCode}
                  disabled={busy}
                  style={[styles.secondaryBtn, busy && styles.btnDisabled]}
                >
                  <Text style={styles.secondaryText}>Send claim code to this email</Text>
                </Pressable>
                <Field
                  icon="ticket-outline"
                  placeholder="Claim code"
                  value={waitlistInput}
                  onChangeText={setWaitlistInput}
                  keyboardType="default"
                  autoCapitalize="characters"
                />
              </>
            ) : null}

            {section === 'profile' ? (
              <Field
                icon="person-outline"
                placeholder="Full name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            ) : null}

            {section === 'email' ? (
              <>
                <Field
                  icon="mail-outline"
                  placeholder="New email address"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Field
                  icon="lock-closed-outline"
                  placeholder="Current password"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                />
              </>
            ) : null}

            {section === 'password' ? (
              <>
                <Field
                  icon="lock-closed-outline"
                  placeholder="Current password"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                />
                <Field
                  icon="key-outline"
                  placeholder="New password (min 8 characters)"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                />
              </>
            ) : null}

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
                  {section === 'waitlist' ? 'Claim free week' : 'Save changes'}
                </Text>
              )}
            </Pressable>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
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
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 16,
  },
  help: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
    marginBottom: 14,
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
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 12,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
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
  cancelBtn: { alignItems: 'center', paddingVertical: 14 },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
});
