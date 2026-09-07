import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { SheetOverlay, resetSheetPointers } from '@/components/ui/SheetOverlay';
import { track, trackScreen } from '@/services/analytics';
import {
  markLocationOnboardingSeen,
  requestForegroundLocation,
} from '@/services/deviceLocation';
import { colors } from '@/theme/colors';
import type { LatLng } from '@/utils/distance';

interface Props {
  open?: boolean;
  onDone: (location: LatLng | null) => void;
}

const PERKS = [
  {
    icon: 'navigate' as const,
    title: 'Show where you are on the map',
    body: 'The blue dot and Recentre use your live position while the app is open.',
  },
  {
    icon: 'sparkles' as const,
    title: 'Nearby events in AI chat',
    body: 'Ask “what’s on near me” and get matches around your area, not the whole city dumped at random.',
  },
  {
    icon: 'car-sport' as const,
    title: 'Directions from where you are',
    body: 'Routes start from your current location. We do not track you in the background.',
  },
];

/**
 * First-launch location card, same shape as the notifications ask.
 * iOS/Android then show the system “While Using the App” prompt.
 */
export function LocationOnboarding({ open, onDone }: Props) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      trackScreen('location_onboarding');
      return;
    }
    if (open === false) setVisible(false);
  }, [open]);

  const finish = (location: LatLng | null) => {
    setVisible(false);
    setBusy(false);
    resetSheetPointers();
    onDone(location);
  };

  const handleEnable = async () => {
    track('location_onboarding_enabled');
    setBusy(true);
    await markLocationOnboardingSeen();
    const location = await requestForegroundLocation();
    track('location_permission_result', { granted: Boolean(location), source: 'onboarding' });
    if (!location) {
      track('location_onboarding_denied');
    }
    finish(location);
  };

  const handleSkip = async () => {
    track('location_onboarding_skipped');
    await markLocationOnboardingSeen();
    finish(null);
  };

  const openSettings = () => {
    void Linking.openSettings().catch(() => undefined);
  };

  if (!visible) return null;

  return (
    <SheetOverlay onRequestClose={handleSkip} dismissOnBackdropPress={false} level={30}>
      <View style={styles.backdrop} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.iconBadge}>
            <Ionicons name="location" size={28} color={colors.textOnPrimary} />
          </View>
          <Text style={styles.title}>Use your location</Text>
          <Text style={styles.subtitle}>
            DriveIQ can show events and delays around you, and start directions
            from where you are. Location stays on this device while you use the app.
            We do not track you after you close it.
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
            You can change this later in your phone Settings, or tap Use my location
            in AI chat.
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
              onPress={() => void handleEnable()}
              style={styles.enableBtn}
              accessibilityRole="button"
              disabled={busy}
            >
              <Text style={styles.enableText}>
                {busy ? 'Asking…' : 'Allow location'}
              </Text>
            </Pressable>
          </View>
          <Pressable onPress={openSettings} hitSlop={8} style={styles.settingsLink}>
            <Text style={styles.settingsLinkText}>Open phone Settings</Text>
          </Pressable>
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
  settingsLink: {
    marginTop: 12,
    alignItems: 'center',
  },
  settingsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
});
