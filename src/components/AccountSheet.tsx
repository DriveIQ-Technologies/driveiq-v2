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
import { colors } from '@/theme/colors';

/** Which sub-form the account sheet opens to. */
export type AccountSection = 'profile' | 'email' | 'password';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(user?.displayName ?? '');
      setEmail(user?.email ?? '');
      setCurrentPassword('');
      setNewPassword('');
      setError(null);
      setBusy(false);
      trackScreen('account_sheet', { section });
    }
  }, [visible, section, user]);

  if (!visible) return null;

  const titles: Record<AccountSection, string> = {
    profile: 'Edit profile',
    email: 'Change email',
    password: 'Change password',
  };

  const submit = async () => {
    setError(null);
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
        if (newPassword.length < 6) {
          setError('New password should be at least 6 characters.');
          return;
        }
        await changePassword(currentPassword, newPassword);
        track('account_password_save_succeeded');
        done('Password changed.');
      }
    } catch (e) {
      track('account_save_failed', { section });
      setError(friendlyAuthError(e));
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
                  placeholder="New password (min 6 characters)"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                />
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={submit}
              disabled={busy}
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
            >
              {busy ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.primaryText}>Save changes</Text>
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
