import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import type { AccountSection } from '@/components/AccountSheet';
import { friendlyAuthError, useAuth } from '@/providers/AuthProvider';
import { track, trackScreen } from '@/services/analytics';
import { showConfirm, showDialog } from '@/services/dialog';
import { colors } from '@/theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Open Change email / Change password forms. */
  onOpenAccount: (section: Extract<AccountSection, 'email' | 'password'>) => void;
}

interface SettingsRow {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  body?: string;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * Account settings hub — change email, change password, delete account.
 * Matches App Store / privacy copy that points users to Settings.
 */
export function SettingsSheet({ visible, onClose, onOpenAccount }: Props) {
  const { user, deleteAccount } = useAuth();

  React.useEffect(() => {
    if (visible) trackScreen('settings_sheet');
  }, [visible]);

  if (!visible) return null;

  const openSection = (section: 'email' | 'password') => {
    onClose();
    setTimeout(() => onOpenAccount(section), 250);
  };

  const confirmDeleteAccount = () =>
    showConfirm(
      'Delete account?',
      'This permanently deletes your DriveIQ account and personal data on our servers. Saved preferences and profile info will be removed. Community reports you posted stay on the map without your name.\n\nDeleting your account does not cancel an App Store or Google Play subscription — manage that separately under Menu → Manage subscription.',
      {
        confirmLabel: 'Delete account',
        destructive: true,
        onConfirm: () => {
          onClose();
          void (async () => {
            try {
              await deleteAccount();
              track('settings_account_deleted');
              showDialog('Account deleted', 'Your DriveIQ account has been deleted.');
            } catch (e) {
              showDialog(
                'Could not delete',
                e instanceof Error ? e.message : friendlyAuthError(e),
              );
            }
          })();
        },
      },
    );

  const rows: SettingsRow[] = [
    {
      key: 'email',
      icon: 'mail',
      label: 'Change email',
      body: user?.email ?? undefined,
      onPress: () => openSection('email'),
    },
    {
      key: 'password',
      icon: 'lock-closed',
      label: 'Change password',
      onPress: () => openSection('password'),
    },
    {
      key: 'delete',
      icon: 'trash',
      label: 'Delete account',
      body: 'Permanently remove your account and data',
      destructive: true,
      onPress: confirmDeleteAccount,
    },
  ];

  return (
    <SheetOverlay onRequestClose={onClose} dim={false} visible={visible}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.sectionTitle}>Account</Text>
          {rows.map((row) => (
            <Pressable
              key={row.key}
              onPress={() => {
                track('settings_row_tapped', { row_key: row.key });
                row.onPress();
              }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
            >
              <View style={styles.rowIcon}>
                <Ionicons
                  name={row.icon}
                  size={20}
                  color={row.destructive ? colors.accent : colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.rowLabel, row.destructive && { color: colors.accent }]}
                >
                  {row.label}
                </Text>
                {row.body ? <Text style={styles.rowBody}>{row.body}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </SheetOverlay>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  body: { paddingVertical: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.primarySoft },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  rowBody: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
});
