import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { track, trackScreen } from '@/services/analytics';
import {
  PREMIUM_UNLOCK_ITEMS,
  premiumUnlockHeadline,
  premiumUnlockLead,
  type PremiumUnlockOutcome,
} from '@/data/premiumUnlockCopy';
import { colors } from '@/theme/colors';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_LOGO = require('../../assets/driveiq-logo.png');

interface Props {
  visible: boolean;
  outcome: PremiumUnlockOutcome | null;
  onClose: () => void;
}

export function PremiumUnlockedSheet({ visible, outcome, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible || !outcome) return;
    trackScreen('premium_unlock_walkthrough', {
      kind: outcome.kind,
      trial: outcome.trialStarted,
    });
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, outcome, enter]);

  if (!visible || !outcome) return null;

  const headline = premiumUnlockHeadline(outcome);
  const lead = premiumUnlockLead(outcome);

  const heroOpacity = enter.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const heroY = enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  const finish = () => {
    track('premium_unlock_walkthrough_done', {
      kind: outcome.kind,
      trial: outcome.trialStarted,
    });
    onClose();
  };

  return (
    <SheetOverlay onRequestClose={finish} level={50} visible={visible} dim={false} dismissOnBackdropPress={false}>
      <View
        style={[
          styles.sheet,
          {
            paddingTop: Math.max(insets.top, 12),
            paddingBottom: Math.max(insets.bottom, 14),
          },
        ]}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Animated.View style={{ opacity: heroOpacity, transform: [{ translateY: heroY }] }}>
            <View style={styles.successBadge}>
              <Ionicons name="checkmark-circle" size={22} color="#26C281" />
              <Text style={styles.successBadgeText}>Premium active</Text>
            </View>
            <View style={styles.logoWrap}>
              <Image source={BRAND_LOGO} style={styles.logo} resizeMode="contain" />
            </View>
            <Text style={styles.headline}>{headline}</Text>
            <Text style={styles.lead}>{lead}</Text>
          </Animated.View>

          <View style={styles.list}>
            {PREMIUM_UNLOCK_ITEMS.map((item) => (
              <View key={item.title} style={styles.row}>
                <View style={[styles.icon, { backgroundColor: `${item.tint}22` }]}>
                  <Ionicons name={item.icon} size={18} color={item.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowBody}>{item.body}</Text>
                </View>
                <Ionicons name="checkmark" size={18} color="#26C281" />
              </View>
            ))}
          </View>

          <View style={styles.note}>
            <Ionicons name="notifications" size={14} color="#26C281" />
            <Text style={styles.noteText}>Disruption alerts stay instant on every plan.</Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.cta} onPress={finish} accessibilityRole="button">
            <Text style={styles.ctaText}>Start exploring</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
          {outcome.trialStarted ? (
            <Text style={styles.finePrint}>
              Cancel anytime in your phone&apos;s subscription settings before day 8 if you do not want to
              continue.
            </Text>
          ) : (
            <Text style={styles.finePrint}>Manage or cancel in your phone&apos;s subscription settings.</Text>
          )}
        </View>
      </View>
    </SheetOverlay>
  );
}

const NIGHT = '#060B14';
const NIGHT_ELEVATED = '#0C1422';

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: NIGHT,
  },
  scroll: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 16,
  },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(38, 194, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(38, 194, 129, 0.28)',
    marginBottom: 18,
  },
  successBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9AE6B4',
  },
  logoWrap: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: NIGHT_ELEVATED,
    borderWidth: 1,
    borderColor: 'rgba(76, 169, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logo: { width: 36, height: 36 },
  headline: {
    textAlign: 'center',
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: '#F4F8FC',
    marginBottom: 10,
  },
  lead: {
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(196, 214, 230, 0.78)',
    marginBottom: 22,
  },
  list: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: NIGHT_ELEVATED,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F4F8FC',
    marginBottom: 3,
  },
  rowBody: {
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(196, 214, 230, 0.72)',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(38, 194, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(38, 194, 129, 0.22)',
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#9AE6B4',
  },
  footer: {
    paddingHorizontal: 22,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(76, 169, 255, 0.18)',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  ctaText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  finePrint: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(196, 214, 230, 0.55)',
  },
});
