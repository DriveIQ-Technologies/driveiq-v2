import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandPulseMark } from '@/components/BrandPulseMark';
import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { track, trackScreen } from '@/services/analytics';
import { loadSavedFlights } from '@/services/savedFlights';
import { loadSavedStations } from '@/services/savedStations';
import { showPremiumPaywall } from '@/services/subscription';
import { markWaitlistEndedShown } from '@/services/waitlistEnded';
import { colors } from '@/theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * What changes now the week is over. Same limits the free plan enforces
 * (3-hour flight board + 1 watched flight, 1 station, daily AI cap, events
 * today and tomorrow).
 */
const CHANGES: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  title: string;
  free: string;
}[] = [
  {
    icon: 'airplane',
    tint: '#4CA9FF',
    title: 'Every flight, all day',
    free: 'Free plan: the next 3 hours and one watched flight',
  },
  {
    icon: 'train',
    tint: '#FF7E47',
    title: 'Every hub you work',
    free: 'Free plan: one saved station',
  },
  {
    icon: 'calendar',
    tint: '#26C281',
    title: 'Weeks ahead, ranked by demand',
    free: 'Free plan: today and tomorrow',
  },
  {
    icon: 'sparkles',
    tint: '#A78BFA',
    title: 'The agent, no daily cap',
    free: 'Free plan: a daily question limit',
  },
];

/**
 * Shown once, the next time a waitlister opens the app after their free
 * Premium week ends. When it shows is decided by services/waitlistEnded.ts.
 * Styled to match the Premium paywall it leads into.
 */
export function WaitlistTrialEndSheet({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  // What they set up during the week. Left out when there's nothing, rather
  // than an empty heading. (No AI count: the quota is today's, not the week's.)
  const [used, setUsed] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    trackScreen('waitlist_trial_end');
    // Only now is it recorded as seen (see services/waitlistEnded.ts).
    void markWaitlistEndedShown();
    setUsed(null);
    void (async () => {
      try {
        const [flights, stations] = await Promise.all([loadSavedFlights(), loadSavedStations()]);
        const bits: string[] = [];
        const f = Object.keys(flights).length;
        const s = Object.keys(stations).length;
        if (f > 0) bits.push(`${f} watched flight${f === 1 ? '' : 's'}`);
        if (s > 0) bits.push(`${s} saved station${s === 1 ? '' : 's'}`);
        setUsed(bits.length ? `This week you set up ${bits.join(' and ')}.` : null);
      } catch {
        setUsed(null);
      }
    })();
  }, [visible]);

  if (!visible) return null;

  return (
    <SheetOverlay onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <View style={styles.handle} />

        <View style={styles.hero}>
          <BrandPulseMark size={52} />
        </View>
        <Text style={styles.kicker}>DriveIQ Premium</Text>
        <Text style={styles.headline}>Your free week is over</Text>
        <Text style={styles.subhead}>
          You're on the free plan now. Keep the whole night with Premium.
        </Text>

        <View style={styles.card}>
          {CHANGES.map((c, i) => (
            <View key={c.title} style={[styles.row, i > 0 && styles.rowDivider]}>
              <View style={[styles.rowIcon, { backgroundColor: `${c.tint}22` }]}>
                <Ionicons name={c.icon} size={17} color={c.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{c.title}</Text>
                <Text style={styles.rowFree}>{c.free}</Text>
              </View>
            </View>
          ))}
        </View>

        {used ? (
          <View style={styles.usedNote}>
            <Ionicons name="checkmark-circle" size={15} color={colors.gradient} />
            <Text style={styles.usedText}>{used}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          accessibilityRole="button"
          onPress={() => {
            track('waitlist_trial_end_upgrade');
            // Close first so the paywall isn't left with this sheet behind it.
            onClose();
            showPremiumPaywall('Continue Premium after waitlist week', {
              source: 'waitlist_day8',
              inline: true,
            });
          }}
        >
          <Text style={styles.primaryText}>Keep Premium</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </Pressable>
        <Pressable
          onPress={() => {
            track('waitlist_trial_end_dismissed');
            onClose();
          }}
          style={styles.secondary}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Continue on the free plan</Text>
        </Pressable>

        <View style={styles.alertNote}>
          <Ionicons name="notifications" size={13} color="#26C281" />
          <Text style={styles.alertNoteText}>Alerts stay instant on every plan.</Text>
        </View>
      </View>
    </SheetOverlay>
  );
}

// Same palette as PremiumPaywallSheet, so the two read as one flow.
const NIGHT = '#060B14';
const NIGHT_ELEVATED = '#0C1422';
const LINE = 'rgba(76, 169, 255, 0.16)';

const styles = StyleSheet.create({
  // Pinned to the bottom like every other sheet. It used to draw from the top
  // of the screen, with its icon under the notch.
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: NIGHT,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: LINE,
    paddingHorizontal: 22,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginTop: 10,
  },
  hero: {
    alignItems: 'center',
    marginTop: -6,
    marginBottom: -14,
  },
  kicker: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.gradient,
    marginBottom: 8,
  },
  headline: {
    textAlign: 'center',
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: '#F4F8FC',
  },
  subhead: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(196, 214, 230, 0.78)',
    fontWeight: '500',
  },
  card: {
    marginTop: 20,
    borderRadius: 18,
    backgroundColor: NIGHT_ELEVATED,
    borderWidth: 1,
    borderColor: LINE,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F4F8FC',
  },
  rowFree: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 17,
    color: 'rgba(196, 214, 230, 0.62)',
  },
  usedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  usedText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(196, 214, 230, 0.85)',
  },
  primary: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
  },
  pressed: { opacity: 0.85 },
  primaryText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 17,
  },
  secondary: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryText: {
    color: 'rgba(196, 214, 230, 0.8)',
    fontSize: 15,
    fontWeight: '600',
  },
  alertNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  alertNoteText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9AE6B4',
  },
});
