import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { track, trackScreen } from '@/services/analytics';
import { getAiQuota } from '@/services/aiQuota';
import { loadSavedFlights } from '@/services/savedFlights';
import { loadSavedStations } from '@/services/savedStations';
import { showPremiumPaywall } from '@/services/subscription';
import {
  hasSeenWaitlistTrialEnd,
  markWaitlistTrialEndSeen,
  getWaitlistTrialEnds,
  waitlistTrialActive,
} from '@/services/waitlist';
import { colors } from '@/theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Day-eight waitlist screen (Part D). Shows what they used, then the offer.
 */
export function WaitlistTrialEndSheet({ visible, onClose }: Props) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    trackScreen('waitlist_trial_end');
    void (async () => {
      const quota = await getAiQuota();
      const flights = await loadSavedFlights();
      const stations = await loadSavedStations();
      const bits: string[] = [];
      if (quota.used > 0) {
        bits.push(
          `You asked ${quota.used} question${quota.used === 1 ? '' : 's'} in AI Event Guide`,
        );
      }
      const flightCount = Object.keys(flights).length;
      if (flightCount > 0) {
        bits.push(
          `You watched ${flightCount} flight${flightCount === 1 ? '' : 's'}`,
        );
      }
      const stationCount = Object.keys(stations).length;
      if (stationCount > 0) {
        bits.push(
          `You saved ${stationCount} station${stationCount === 1 ? '' : 's'}`,
        );
      }
      if (bits.length === 0) {
        bits.push('You tried DriveIQ Premium for a week');
      }
      setLines(bits);
    })();
  }, [visible]);

  if (!visible) return null;

  return (
    <SheetOverlay onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.iconWrap}>
          <Ionicons name="star" size={28} color={colors.primaryDark} />
        </View>
        <Text style={styles.title}>Your Premium week has ended</Text>
        <Text style={styles.lead}>
          Here is what you used while it lasted:
        </Text>
        {lines.map((line) => (
          <Text key={line} style={styles.bullet}>
            · {line}
          </Text>
        ))}
        <Text style={styles.body}>
          Keep full-day flights, every station, and unlimited AI with DriveIQ Premium.
        </Text>
        <Pressable
          style={styles.primary}
          onPress={() => {
            track('waitlist_trial_end_upgrade');
            showPremiumPaywall('Continue Premium after waitlist week', {
              source: 'waitlist_day8',
              inline: true,
            });
          }}
        >
          <Text style={styles.primaryText}>Continue with Premium</Text>
        </Pressable>
        <Pressable onPress={() => {
          void markWaitlistTrialEndSeen();
          onClose();
        }} style={styles.secondary}>
          <Text style={styles.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    </SheetOverlay>
  );
}

/** True when trial ended in the last 48h and sheet not yet dismissed. */
export async function shouldShowWaitlistTrialEnd(): Promise<boolean> {
  if (await hasSeenWaitlistTrialEnd()) return false;
  const active = await waitlistTrialActive();
  if (active) return false;
  const ends = await getWaitlistTrialEnds();
  if (!ends) return false;
  const endMs = Date.parse(ends);
  if (!Number.isFinite(endMs)) return false;
  const now = Date.now();
  return now > endMs && now - endMs < 48 * 60 * 60 * 1000;
}

export { markWaitlistTrialEndSeen };

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginVertical: 10,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  lead: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  bullet: {
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 4,
    lineHeight: 22,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
    marginTop: 12,
    marginBottom: 20,
  },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  secondary: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
