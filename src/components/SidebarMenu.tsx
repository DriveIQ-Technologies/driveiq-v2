import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import React from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/AuthProvider';
import { track, trackScreen } from '@/services/analytics';
import { colors } from '@/theme/colors';
import type { AccountSection } from '@/components/AccountSheet';

// DriveIQ brand mark shown in the sidebar header.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_LOGO = require('../../assets/driveiq-logo.png');

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called when the user taps the Notifications row — wires through to the
   *  existing NotificationSettingsPanel rather than building a duplicate. */
  onOpenNotifications: () => void;
  /** Open the sign-in / create-account sheet. */
  onOpenAuth: (mode: 'signin' | 'signup') => void;
  /** Open a signed-in account-management section. */
  onOpenAccount: (section: AccountSection) => void;
  /** Support sheets. */
  onOpenHelp: () => void;
  onOpenFeedback: () => void;
  onOpenAbout: () => void;
  onOpenAISupport: () => void;
}

interface MenuRow {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  body?: string;
  /** When `null`, the row uses the built-in placeholder alert. */
  handler?: (() => void) | null;
  /** Optional pill rendered on the right (e.g. "Free plan"). */
  badge?: string;
  /** Whether the row should pop off the destructive accent (e.g. Sign out). */
  destructive?: boolean;
}

/**
 * Account / settings drawer. Renders as a left-edge sidebar (full height,
 * 82% width) that slides over the map. Rows currently route either to
 * existing screens (Notifications) or a placeholder alert until the
 * auth/payment backends are wired up.
 */
export function SidebarMenu({
  visible,
  onClose,
  onOpenNotifications,
  onOpenAuth,
  onOpenAccount,
  onOpenHelp,
  onOpenFeedback,
  onOpenAbout,
  onOpenAISupport,
}: Props) {
  const { user, logout, hasAccount } = useAuth();
  const signedIn = hasAccount;

  React.useEffect(() => {
    if (visible) trackScreen('sidebar_menu', { signed_in: signedIn });
  }, [visible, signedIn]);

  if (!visible) return null;

  const placeholder = (label: string) =>
    Alert.alert(
      label,
      'This will be wired once we connect the payments backend. The UI shell is already in place.',
    );

  // Defer a navigation/sheet action until the sidebar has slid out, so the
  // two modal animations don't collide.
  const afterClose = (fn: () => void) => {
    onClose();
    setTimeout(fn, 250);
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          onClose();
          logout().catch(() => undefined);
        },
      },
    ]);

  const accountRows: MenuRow[] = signedIn
    ? [
        {
          key: 'profile',
          icon: 'person-circle',
          label: 'Edit profile',
          handler: () => afterClose(() => onOpenAccount('profile')),
        },
        {
          key: 'email',
          icon: 'mail',
          label: 'Change email',
          handler: () => afterClose(() => onOpenAccount('email')),
        },
        {
          key: 'password',
          icon: 'lock-closed',
          label: 'Change password',
          handler: () => afterClose(() => onOpenAccount('password')),
        },
        {
          key: 'signout',
          icon: 'log-out',
          label: 'Sign out',
          handler: confirmSignOut,
          destructive: true,
        },
      ]
    : [
        {
          key: 'signin',
          icon: 'log-in',
          label: 'Sign in',
          handler: () => afterClose(() => onOpenAuth('signin')),
        },
        {
          key: 'signup',
          icon: 'person-add',
          label: 'Create an account',
          handler: () => afterClose(() => onOpenAuth('signup')),
        },
      ];

  const preferencesRows: MenuRow[] = [
    {
      key: 'notifications',
      icon: 'notifications',
      label: 'Notifications',
      body: 'Roads, train lines, saved events',
      handler: () => {
        onClose();
        // Defer to next tick so the sidebar's slide-out animation can start
        // before the notifications sheet slides up. Avoids a visual jump.
        setTimeout(onOpenNotifications, 250);
      },
    },
  ];

  const billingRows: MenuRow[] = [
    {
      key: 'upgrade',
      icon: 'rocket',
      label: 'Upgrade to Premium',
      body: 'Push alerts, route history, no rate limits',
      badge: 'Free plan',
      handler: null,
    },
    { key: 'payment', icon: 'card', label: 'Payment methods', handler: null },
    { key: 'billing', icon: 'receipt', label: 'Billing history', handler: null },
  ];

  const supportRows: MenuRow[] = [
    {
      key: 'help',
      icon: 'help-circle',
      label: 'Help & FAQs',
      handler: () => afterClose(onOpenHelp),
    },
    {
      key: 'feedback',
      icon: 'chatbubble',
      label: 'Send feedback',
      handler: () => afterClose(onOpenFeedback),
    },
    {
      key: 'ai-support',
      icon: 'sparkles',
      label: 'DriveIQ AI Support',
      body: 'Ask how anything works',
      handler: () => afterClose(onOpenAISupport),
    },
    {
      key: 'about',
      icon: 'information-circle',
      label: 'About DriveIQ',
      handler: () => afterClose(onOpenAbout),
    },
  ];

  const renderRow = (row: MenuRow) => (
    <Pressable
      key={row.key}
      onPress={() => {
        track('sidebar_row_tapped', { row_key: row.key, signed_in: signedIn });
        if (row.handler) row.handler();
        else placeholder(row.label);
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
          style={[
            styles.rowLabel,
            row.destructive && { color: colors.accent },
          ]}
        >
          {row.label}
        </Text>
        {row.body ? <Text style={styles.rowBody}>{row.body}</Text> : null}
      </View>
      {row.badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{row.badge}</Text>
        </View>
      ) : (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textSecondary}
        />
      )}
    </Pressable>
  );

  return (
    // Side panel (not a modal) so the map stays live behind it — you can pan
    // and zoom with the menu open, and it only closes via the X. box-none lets
    // touches outside the sheet reach the map underneath.
    <View style={styles.overlay} pointerEvents="box-none">
      <SafeAreaView edges={['top', 'left']} style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.brandBlock}>
              <View style={styles.brandLogoBacking}>
                <Image
                  source={BRAND_LOGO}
                  resizeMode="contain"
                  style={styles.brandLogo}
                  accessibilityIgnoresInvertColors
                />
              </View>
              <Text style={styles.brandText}>DriveIQ</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: 28 }}
          >
            {signedIn ? (
              <View style={styles.identity}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(user?.displayName?.trim()?.[0] ??
                      user?.email?.[0] ??
                      '?').toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.identityName} numberOfLines={1}>
                    {user?.displayName?.trim() || 'DriveIQ user'}
                  </Text>
                  <Text style={styles.identityEmail} numberOfLines={1}>
                    {user?.email ?? ''}
                  </Text>
                </View>
              </View>
            ) : (
              <Pressable
                style={styles.signedOutCard}
                onPress={() => afterClose(() => onOpenAuth('signin'))}
                accessibilityRole="button"
              >
                <View style={styles.avatar}>
                  <Ionicons name="person" size={22} color={colors.textOnPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.identityName}>You're signed out</Text>
                  <Text style={styles.identityEmail}>
                    Sign in to sync events & alerts
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            )}

            <Section title={signedIn ? 'Account' : 'Sign in'} rows={accountRows} render={renderRow} />
            <Section title="Preferences" rows={preferencesRows} render={renderRow} />
            <Section title="Plan & billing" rows={billingRows} render={renderRow} />
            <Section title="Support" rows={supportRows} render={renderRow} />

            <Text style={styles.versionText}>{`DriveIQ v${Constants.expoConfig?.version ?? 'n/a'}`}</Text>
          </ScrollView>
        </SafeAreaView>
    </View>
  );
}

function Section({
  title,
  rows,
  render,
}: {
  title: string;
  rows: MenuRow[];
  render: (row: MenuRow) => React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionInner}>{rows.map(render)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  sheet: {
    width: '82%',
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 10,
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 14,
    marginBottom: 4,
  },
  // Centered brand lockup: large logo on a soft-tint backing + wordmark.
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandLogoBacking: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogo: {
    width: 32,
    height: 38,
  },
  brandText: {
    color: colors.primaryDark,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontSize: 22,
  },
  closeBtn: {
    position: 'absolute',
    right: 0,
    top: 14,
  },
  body: { flex: 1 },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 18,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  signedOutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 18,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.textOnPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  identityName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  identityEmail: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionInner: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  rowPressed: {
    backgroundColor: colors.primarySoft,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rowBody: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  badgeText: {
    color: colors.textOnPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
  },
});
