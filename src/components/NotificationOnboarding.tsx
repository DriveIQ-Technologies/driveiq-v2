import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '@/theme/colors';
import { track, trackScreen } from '@/services/analytics';
import {
  ensurePermission,
  hasSeenOnboarding,
  markOnboardingSeen,
} from '@/services/notifications';

interface Props {
  /** Called when the user closes the popup (either decision). */
  onDone: () => void;
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
    title: 'Events you’ve saved',
    body: 'A reminder one hour before any event you save, so there is always time to plan your route.',
  },
];

/**
 * One-shot first-launch popup that explains what DriveIQ will notify you
 * about and asks for permission. Stored as "seen" once dismissed so it
 * never re-appears — users can revisit notification settings from the
 * Notifications panel any time.
 */
export function NotificationOnboarding({ onDone }: Props) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Decide whether to show on mount. Defer to next tick so the map paints
  // first and the modal slides up over it — feels less like an interrupt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await hasSeenOnboarding();
      if (cancelled) return;
      if (!seen) {
        // Small delay so it doesn't fire at the exact same instant as the
        // map markers appearing.
        setTimeout(() => {
          if (!cancelled) {
            setVisible(true);
            trackScreen('notification_onboarding');
          }
        }, 900);
      } else {
        onDone();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onDone]);

  const handleEnable = async () => {
    track('notification_onboarding_enabled');
    setBusy(true);
    const granted = await ensurePermission();
    track('notification_permission_result', { granted });
    await markOnboardingSeen();
    setVisible(false);
    setBusy(false);
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
    <Modal transparent animationType="fade" visible onRequestClose={handleSkip}>
      <View style={styles.backdrop}>
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
            You stay in control. Every category has its own toggle in
            Settings, and per-line subscriptions let you pick exactly which
            lines to follow.
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
                {busy ? 'Enabling…' : 'Enable notifications'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 42, 58, 0.55)',
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
