import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandPulseMark } from '@/components/BrandPulseMark';
import { SheetOverlay } from '@/components/ui/SheetOverlay';
import {
  FREE_ACCOUNT_ITEMS,
  FREE_ACCOUNT_LIMITS,
  type AccountReadyInfo,
} from '@/data/freeAccountCopy';
import { useAuth } from '@/providers/AuthProvider';
import { track, trackScreen } from '@/services/analytics';
import { colors } from '@/theme/colors';

interface Props {
  visible: boolean;
  info: AccountReadyInfo | null;
  onClose: () => void;
}

export function AccountReadySheet({ visible, info, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { sendVerificationEmail } = useAuth();
  const [sent, setSent] = useState<boolean | null>(info?.verificationSent ?? null);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!visible || !info) return;
    setSent(info.verificationSent);
    trackScreen('account_ready_walkthrough');
  }, [visible, info]);

  if (!visible || !info) return null;

  const first = info.name.trim().split(/\s+/)[0] || 'there';

  const finish = () => {
    track('account_ready_walkthrough_done');
    onClose();
  };

  const resend = async () => {
    if (resending) return;
    setResending(true);
    const ok = await sendVerificationEmail();
    setSent(ok);
    setResending(false);
  };

  return (
    <SheetOverlay
      onRequestClose={finish}
      level={48}
      visible={visible}
      dim={false}
      dismissOnBackdropPress={false}
    >
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
          <View style={styles.badge}>
            <Ionicons name="checkmark-circle" size={22} color="#26C281" />
            <Text style={styles.badgeText}>Free account ready</Text>
          </View>
          <BrandPulseMark size={64} />
          <Text style={styles.headline}>Hi {first}. You are in.</Text>
          <Text style={styles.lead}>
            Here is what this account can do today, and where it stops. Nothing to pay.
          </Text>

          <Text style={styles.section}>On the free plan</Text>
          <View style={styles.list}>
            {FREE_ACCOUNT_ITEMS.map((item) => (
              <View key={item.title} style={styles.row}>
                <View style={[styles.icon, { backgroundColor: `${item.tint}22` }]}>
                  <Ionicons name={item.icon} size={18} color={item.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowBody}>{item.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.section}>Limits</Text>
          <View style={styles.list}>
            {FREE_ACCOUNT_LIMITS.map((item) => (
              <View key={item.title} style={styles.row}>
                <View style={[styles.icon, { backgroundColor: `${item.tint}22` }]}>
                  <Ionicons name={item.icon} size={18} color={item.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowBody}>{item.body}</Text>
                </View>
              </View>
            ))}
          </View>

          {sent !== null ? (
            <View style={[styles.verify, sent ? styles.verifyOk : styles.verifyWarn]}>
              <Ionicons
                name={sent ? 'mail-open-outline' : 'mail-unread-outline'}
                size={16}
                color={sent ? '#9AE6B4' : '#F6C177'}
              />
              <Text style={[styles.verifyText, sent ? styles.verifyOkText : styles.verifyWarnText]}>
                {sent
                  ? `Check ${info.email} for a short verify link so we can keep saves and alerts on this account.`
                  : `We could not send a verify email to ${info.email} just now. Tap resend, or check spam. Your account still works.`}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {sent === false ? (
            <Pressable style={styles.secondary} onPress={() => void resend()} disabled={resending}>
              {resending ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.secondaryText}>Resend verify email</Text>
              )}
            </Pressable>
          ) : null}
          <Pressable style={styles.cta} onPress={finish} accessibilityRole="button">
            <Text style={styles.ctaText}>Start exploring</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>
    </SheetOverlay>
  );
}

const NIGHT = '#060B14';
const NIGHT_ELEVATED = '#0C1422';

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: NIGHT },
  scroll: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 16 },
  badge: {
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
  badgeText: { fontSize: 13, fontWeight: '700', color: '#9AE6B4' },
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
  section: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: 'rgba(196, 214, 230, 0.5)',
    marginBottom: 8,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  list: { gap: 10, marginBottom: 8 },
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
  rowTitle: { fontSize: 15, fontWeight: '700', color: '#F4F8FC', marginBottom: 3 },
  rowBody: { fontSize: 13, lineHeight: 18, color: 'rgba(196, 214, 230, 0.72)' },
  verify: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  verifyOk: {
    backgroundColor: 'rgba(38, 194, 129, 0.1)',
    borderColor: 'rgba(38, 194, 129, 0.22)',
  },
  verifyWarn: {
    backgroundColor: 'rgba(246, 193, 119, 0.1)',
    borderColor: 'rgba(246, 193, 119, 0.28)',
  },
  verifyText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  verifyOkText: { color: '#9AE6B4' },
  verifyWarnText: { color: '#F6C177' },
  footer: {
    paddingHorizontal: 22,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(76, 169, 255, 0.18)',
  },
  secondary: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NIGHT_ELEVATED,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  secondaryText: { color: '#F4F8FC', fontSize: 15, fontWeight: '700' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
