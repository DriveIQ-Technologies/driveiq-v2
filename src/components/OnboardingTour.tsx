import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { colors } from '@/theme/colors';
import { track, trackScreen } from '@/services/analytics';
import { hasSeenTour, markTourSeen } from '@/services/onboarding';

interface Props {
  /** Fired once the tour is finished or skipped (and for returning users who
   *  have already seen it) so the parent can move on to the next first-launch
   *  step (e.g. Create account, then the notifications ask). */
  onDone: (reason: 'completed' | 'already_seen') => void;
}

interface Step {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: 'map',
    title: 'Welcome to DriveIQ',
    body: "Everything on across London on one live map. Sport, music, theatre and more, next to real-time roads and transport. Here's a 30-second tour.",
  },
  {
    icon: 'location',
    title: 'Pins are events',
    body: 'Each ringed pin is an event. The ring colour is the category. Blue means sports, purple music, pink theatre, and so on. Sports show their symbol (⚽ 🏏 🏇), and a gold ring with a ⭐ is a featured event like Royal Ascot. Tap any pin for details.',
  },
  {
    icon: 'options',
    title: 'Filter the map',
    body: 'Use the chips at the top to switch between All, Today, Tomorrow and the next few days, and the category chips to focus on what you care about. The map re-frames to fit.',
  },
  {
    icon: 'bookmark',
    title: 'Save what matters',
    body: "Open an event and tap Save. You'll get a ping 1 hour before it starts and 25 minutes before crowds leave, or add it straight to your phone's calendar.",
  },
  {
    icon: 'train',
    title: 'Roads & transport, live',
    body: 'The buttons on the right show live tube, rail and tram status, London airports, and major road incidents, so you can plan around delays before you set off.',
  },
  {
    icon: 'add-circle',
    title: 'Report what you see',
    body: "Spotted a hazard, accident or closure? Tap ➕, drag the map to drop the pin, then tell other drivers. They get a ping, and they can tap thumbs up if they can see it too.",
  },
];

/**
 * First-launch coachmark tour. A sequence of full-screen cards explaining the
 * map, pins, filters, saving, transport and reporting. Shown once; the "seen"
 * flag lives in services/onboarding so it never re-appears.
 */
export function OnboardingTour({ onDone }: Props) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const seen = await hasSeenTour();
      if (cancelled) return;
      if (seen) {
        onDone('already_seen');
      } else {
        // Let the map paint first.
        timer = setTimeout(() => {
          if (!cancelled) {
            setVisible(true);
            trackScreen('onboarding_tour');
          }
        }, 500);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [onDone]);

  const finish = async () => {
    track('onboarding_tour_completed', { steps_seen: step + 1 });
    await markTourSeen();
    setVisible(false);
    onDone('completed');
  };

  const next = () => {
    if (step >= STEPS.length - 1) {
      finish();
    } else {
      track('onboarding_tour_next', { step: step + 1 });
      setStep((s) => s + 1);
    }
  };

  if (!visible) return null;
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <SheetOverlay onRequestClose={finish} dismissOnBackdropPress={false}>
      <View style={styles.backdrop} pointerEvents="box-none">
        <View style={styles.card}>
          <Pressable
            onPress={() => {
              track('onboarding_tour_skipped', { step: step + 1 });
              void finish();
            }}
            style={styles.skip}
            hitSlop={10}
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>

          <View style={styles.iconBadge}>
            <Ionicons name={current.icon} size={30} color={colors.textOnPrimary} />
          </View>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>

          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === step && styles.dotActive]}
              />
            ))}
          </View>

          <Pressable onPress={next} style={styles.nextBtn} accessibilityRole="button">
            <Text style={styles.nextText}>{isLast ? "Let's go" : 'Next'}</Text>
            <Ionicons
              name={isLast ? 'checkmark' : 'arrow-forward'}
              size={18}
              color={colors.textOnPrimary}
            />
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
    borderRadius: 24,
    padding: 24,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  skip: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  iconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: 22,
  },
  dots: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 22,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 20,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  nextText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
});
