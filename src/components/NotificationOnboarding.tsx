import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme/colors';
import { track, trackScreen } from '@/services/analytics';
import {
  DEFAULT_PREFS,
  ensurePermission,
  hasSeenOnboarding,
  markOnboardingSeen,
  savePrefs,
} from '@/services/notifications';

interface Props {
  /** Called when the user closes the popup (either decision). */
  onDone: () => void;
  /** Controlled mode: show when true (e.g. after first station save). */
  open?: boolean;
}

interface PerkRow {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
}

const PERKS: PerkRow[] = [
  {
    icon: 'car-sport',
    title: 'Road closures and heavy traffic',
    body: 'A heads-up when key routes such as the M25, A40 or Blackwall Tunnel close or turn into major delays.',
  },
  {
    icon: 'train',
    title: 'Train & tube disruptions',
    body: 'Be the first to know when your tube, Overground, Elizabeth line, DLR or National Rail operator goes into Severe or Closed status. You can pick specific lines in Settings.',
  },
  {
    icon: 'calendar',
    title: 'Events you have saved',
    body: 'Two reminders: 1 hour before it starts, and 25 minutes before crowds leave.',
  },
];

/**
 * One-shot first-launch popup that explains what DriveIQ will notify you
 * about and asks for permission. Stored as "seen" once dismissed so it
 * never re-appears — users can revisit notification settings from the
 * Notifications panel any time.
 */
export function NotificationOnboarding({ onDone, open }: Props) {
  const { hasAccount, requireAccount } = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      trackScreen('notification_onboarding');
      return;
    }
    if (open === false) {
      setVisible(false);
    }
  }, [open]);

  const handleEnable = async () => {
    // No account yet: alerts have nowhere to go, so send the user to create
    // one instead of burning the one-shot iOS permission prompt. Dismiss this
    // card first — two modals presented at once wedges touch handling.
    if (!hasAccount) {
      track('notification_onboarding_account_required');
      await markOnboardingSeen();
      setVisible(false);
      onDone();
      requireAccount('notify', () => {
        void (async () => {
          await savePrefs({ ...DEFAULT_PREFS });
          const granted = await ensurePermission();
          track('notification_permission_result', {
            granted,
            after_signup: true,
          });
        })();
      });
      return;
    }

    track('notification_onboarding_enabled');
    setBusy(true);
    const granted = await ensurePermission();
    track('notification_permission_result', { granted });
    await markOnboardingSeen();
    setVisible(false);
    setBusy(false);
    const { registerPushToken } = await import('@/services/pushTokens');
    void registerPushToken();
    onDone();
  };

  const handleSkip = async () => {
    track('notification_onboarding_skipped');
    await markOnboardingSeen();
    setVisible(false);
    onDone();
  };

  if (!visible) return null;

  return (
    <SheetOverlay onRequestClose={handleSkip} dismissOnBackdropPress={false}>
      <View style={styles.backdrop} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.iconBadge}>
            <Ionicons
              name="notifications"
              size={28}
              color={colors.textOnPrimary}
            />
          </View>
          <Text style={styles.title}>Stay ahead with DriveIQ</Text>
          <Text style={styles.subtitle}>
            We can give you a quiet heads-up when something important
            happens on your route or for events you care about.
          </Text>

          <View style={styles.perkList}>
            {PERKS.map((row) => (
              <View key={row.title} style={styles.perkRow}>
                <View style={styles.perkIcon}>
                  <Ionicons name={row.icon} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.perkTitle}>{row.title}</Text>
                  <Text style={styles.perkBody}>{row.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.footer}>
            {hasAccount
              ? 'You stay in control. Every category has its own toggle in Settings, and per-line subscriptions let you pick exactly which lines to follow.'
              : 'Alerts need a free account so we know where to send them. You stay in control. Every category has its own toggle in Settings once you are in.'}
          </Text>

          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleSkip}
              style={styles.skipBtn}
              accessibilityRole="button"
              disabled={busy}
            >
              <Text style={styles.skipText}>Not now</Text>
            </Pressable>
            <Pressable
              onPress={handleEnable}
              style={styles.enableBtn}
              accessibilityRole="button"
              disabled={busy}
            >
              <Text style={styles.enableText}>
                {busy
                  ? 'Enabling…'
                  : hasAccount
                    ? 'Enable notifications'
                    : 'Create free account'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SheetOverlay>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 22,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  perkList: {
    gap: 12,
    marginBottom: 16,
  },
  perkRow: {
    flexDirection: 'row',
    gap: 12,
  },
  perkIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  perkBody: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  footer: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginBottom: 18,
    fontStyle: 'italic',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  enableBtn: {
    flex: 1.4,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enableText: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
});
