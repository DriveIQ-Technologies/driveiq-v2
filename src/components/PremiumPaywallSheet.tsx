import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { track, trackScreen } from '@/services/analytics';
import {
  configurePurchases,
  getCachedPremiumPackages,
  getCurrentOffering,
  isPurchasesNativeAvailable,
  packageDisplayTitle,
  packageHasFreeTrial,
  packagePeriodLabel,
  packagePriceLabel,
  preferredPremiumPackage,
  purchasePackage,
  purchasesUnavailableMessage,
  restorePurchases,
  sortPremiumPackages,
  PACKAGE_ANNUAL_ID,
} from '@/services/purchases';
import { syncPremiumEntitlement } from '@/services/subscription';
import { colors } from '@/theme/colors';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_LOGO = require('../../assets/driveiq-logo.png');

const TERMS_URL = 'https://driveiq.app/terms';
const PRIVACY_URL = 'https://driveiq.app/privacy';

const FEATURES: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  title: string;
  body: string;
}[] = [
  {
    icon: 'airplane',
    tint: '#4CA9FF',
    title: 'Every flight, all day',
    body: 'Watch arrivals across all five airports. Free stops at one flight and three hours.',
  },
  {
    icon: 'train',
    tint: '#FF7E47',
    title: 'Every hub you work',
    body: 'Paddington, Victoria, Liverpool Street — save them all, not just one.',
  },
  {
    icon: 'calendar',
    tint: '#26C281',
    title: 'Weeks ahead, ranked by demand',
    body: 'See which nights are worth working before you take one off.',
  },
  {
    icon: 'sparkles',
    tint: '#A78BFA',
    title: 'The agent, no daily cap',
    body: 'Ask anything, as often as you want — plan a whole shift, not one question.',
  },
];

interface Props {
  visible: boolean;
  feature?: string;
  source?: string;
  onClose: () => void;
  onUnlocked?: () => void;
  onSuccess?: (outcome: import('@/data/premiumUnlockCopy').PremiumUnlockOutcome) => void;
  onFailure?: (failure: import('@/services/premiumPurchaseFlow').PurchaseFlowFailure) => void;
}

function isAnnual(pkg: PurchasesPackage): boolean {
  return pkg.identifier === PACKAGE_ANNUAL_ID || pkg.packageType === 'ANNUAL';
}

function monthlyEquivalent(pkg: PurchasesPackage): string | null {
  if (!isAnnual(pkg)) return null;
  const price = pkg.product.price;
  if (typeof price !== 'number' || !(price > 0)) return null;
  const perMonth = price / 12;
  const currency = pkg.product.currencyCode ?? 'GBP';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(perMonth);
  } catch {
    return `£${perMonth.toFixed(2)}`;
  }
}

export function PremiumPaywallSheet({
  visible,
  feature,
  source,
  onClose,
  onUnlocked,
  onSuccess,
  onFailure,
}: Props) {
  const insets = useSafeAreaInsets();
  const cached = getCachedPremiumPackages();
  const [packages, setPackages] = useState<PurchasesPackage[]>(cached);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => preferredPremiumPackage(cached)?.identifier ?? cached[0]?.identifier ?? null,
  );
  const [loading, setLoading] = useState(cached.length === 0);
  const [busy, setBusy] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    trackScreen('premium_paywall', { feature, source });
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const warm = getCachedPremiumPackages();
    if (warm.length > 0) {
      setPackages(warm);
      setSelectedId(
        preferredPremiumPackage(warm)?.identifier ?? warm[0]?.identifier ?? null,
      );
      setLoading(false);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    void (async () => {
      await configurePurchases();
      // Prefer cache; only hit network if launch prefetch has not finished.
      const offering = await getCurrentOffering(warm.length === 0);
      if (cancelled) return;
      const pkgs = sortPremiumPackages(offering?.availablePackages ?? []);
      setPackages(pkgs);
      setSelectedId(
        preferredPremiumPackage(pkgs)?.identifier ?? pkgs[0]?.identifier ?? null,
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, feature, source, enter]);

  const selected = useMemo(
    () => packages.find((p) => p.identifier === selectedId) ?? packages[0],
    [packages, selectedId],
  );

  const hasTrial = selected ? packageHasFreeTrial(selected) : true;
  const ctaLabel = hasTrial
    ? 'Start 7 days free'
    : selected
      ? `Subscribe · ${packagePriceLabel(selected)}`
      : 'Subscribe';

  const finePrint = (() => {
    if (!selected) return 'Cancel anytime in Settings.';
    const price = packagePriceLabel(selected);
    const period = isAnnual(selected) ? 'a year' : 'a month';
    if (hasTrial) {
      return `Nothing to pay for 7 days. Then ${price} ${period}. Cancel anytime in Settings.`;
    }
    return `${price} ${period}. Cancel anytime in Settings.`;
  })();

  const buy = async () => {
    if (!selected || busy) return;
    setBusy(true);
    track('paywall_purchase_tapped', {
      package_id: selected.identifier,
      product_id: selected.product.identifier,
      source,
    });
    const result = await purchasePackage(selected);
    setBusy(false);
    if (result.ok) {
      await syncPremiumEntitlement();
      onUnlocked?.();
      onClose();
      onSuccess?.({
        kind: 'purchase',
        trialStarted: selected ? packageHasFreeTrial(selected) : false,
      });
      return;
    }
    onFailure?.({ kind: 'purchase', cancelled: result.cancelled, message: result.message });
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    const result = await restorePurchases();
    setBusy(false);
    if (result.ok) {
      await syncPremiumEntitlement();
      onUnlocked?.();
      onClose();
      onSuccess?.({ kind: 'restore', trialStarted: false });
      return;
    }
    onFailure?.({ kind: 'restore', cancelled: result.cancelled, message: result.message });
  };

  const openUrl = (url: string) => {
    void Linking.openURL(url).catch(() => undefined);
  };

  if (!visible) return null;

  const heroOpacity = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const heroY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });

  return (
    <SheetOverlay
      onRequestClose={onClose}
      level={40}
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
        <Pressable
          style={[styles.close, { top: Math.max(insets.top, 12) + 2 }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <Ionicons name="close" size={22} color="rgba(255,255,255,0.72)" />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          bounces
          style={styles.scrollFlex}
        >
          <Animated.View style={{ opacity: heroOpacity, transform: [{ translateY: heroY }] }}>
            <View style={styles.heroGlow} />
            <View style={styles.logoWrap}>
              <Image source={BRAND_LOGO} style={styles.logo} resizeMode="contain" />
            </View>
            <Text style={styles.kicker}>DriveIQ Premium</Text>
            <Text style={styles.headline}>
              Start your shift{'\n'}knowing how it ends
            </Text>
            <Text style={styles.subhead}>The whole night, not the next three hours.</Text>
          </Animated.View>

          <View style={styles.featureList}>
            {FEATURES.map((f) => (
              <View key={f.title} style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: `${f.tint}22` }]}>
                  <Ionicons name={f.icon} size={18} color={f.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureBody}>{f.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.alertNote}>
            <Ionicons name="notifications" size={14} color="#26C281" />
            <Text style={styles.alertNoteText}>Alerts stay instant on every plan.</Text>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.gradient} />
            </View>
          ) : packages.length === 0 ? (
            <Text style={styles.emptyOffer}>
              {!isPurchasesNativeAvailable()
                ? purchasesUnavailableMessage()
                : 'Plans could not be loaded. Check your connection, or try Restore if you already subscribed.'}
            </Text>
          ) : (
            <View style={styles.plans}>
              {packages.map((pkg) => {
                const active = pkg.identifier === selected?.identifier;
                const annual = isAnnual(pkg);
                const perMonth = monthlyEquivalent(pkg);
                return (
                  <Pressable
                    key={pkg.identifier}
                    onPress={() => setSelectedId(pkg.identifier)}
                    style={[styles.plan, active && styles.planActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <View
                      style={[styles.radio, active && styles.radioActive]}
                    >
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.planTitle}>
                        {annual ? 'Yearly' : packageDisplayTitle(pkg)}
                      </Text>
                      <Text style={styles.planPrice}>
                        {packagePriceLabel(pkg)}{' '}
                        <Text style={styles.planPeriod}>
                          {annual
                            ? `a year${perMonth ? ` · ${perMonth} / mo` : ''}`
                            : packagePeriodLabel(pkg).replace('per ', 'a ')}
                        </Text>
                      </Text>
                    </View>
                    {annual ? (
                      <View style={styles.bestBadge}>
                        <Text style={styles.bestBadgeText}>Best value</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.cta, (busy || !selected) && styles.ctaDisabled]}
            onPress={() => void buy()}
            disabled={busy || !selected}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.ctaText}>{ctaLabel}</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </Pressable>
          <Text style={styles.finePrint}>{finePrint}</Text>
          <View style={styles.legalRow}>
            <Pressable onPress={() => openUrl(TERMS_URL)} hitSlop={8}>
              <Text style={styles.legalLink}>Terms</Text>
            </Pressable>
            <Text style={styles.legalDot}>·</Text>
            <Pressable onPress={() => openUrl(PRIVACY_URL)} hitSlop={8}>
              <Text style={styles.legalLink}>Privacy</Text>
            </Pressable>
            <Text style={styles.legalDot}>·</Text>
            <Pressable onPress={() => void restore()} hitSlop={8} disabled={busy}>
              <Text style={styles.legalLink}>Restore</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SheetOverlay>
  );
}

const NIGHT = '#060B14';
const NIGHT_ELEVATED = '#0C1422';
const LINE = 'rgba(76, 169, 255, 0.18)';

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: NIGHT,
    overflow: 'hidden',
  },
  close: {
    position: 'absolute',
    left: 14,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  scrollFlex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 22,
    paddingTop: 44,
    paddingBottom: 16,
    flexGrow: 1,
  },
  heroGlow: {
    position: 'absolute',
    top: -40,
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(45, 125, 246, 0.22)',
  },
  logoWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: NIGHT_ELEVATED,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    marginBottom: 16,
  },
  logo: { width: 40, height: 40 },
  kicker: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.gradient,
    marginBottom: 10,
  },
  headline: {
    textAlign: 'center',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: '#F4F8FC',
  },
  subhead: {
    textAlign: 'center',
    marginTop: 10,
    fontSize: 16,
    lineHeight: 22,
    color: 'rgba(196, 214, 230, 0.78)',
    fontWeight: '500',
  },
  featureList: {
    marginTop: 26,
    gap: 14,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F4F8FC',
    marginBottom: 3,
  },
  featureBody: {
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(196, 214, 230, 0.72)',
  },
  alertNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    marginBottom: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(38, 194, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(38, 194, 129, 0.22)',
  },
  alertNoteText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#9AE6B4',
  },
  loadingBox: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  emptyOffer: {
    textAlign: 'center',
    color: 'rgba(196, 214, 230, 0.7)',
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 24,
  },
  plans: {
    marginTop: 14,
    gap: 10,
  },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: NIGHT_ELEVATED,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  planActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(45, 125, 246, 0.14)',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F4F8FC',
  },
  planPrice: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(244, 248, 252, 0.92)',
  },
  planPeriod: {
    fontWeight: '500',
    color: 'rgba(196, 214, 230, 0.7)',
  },
  bestBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  bestBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.2,
  },
  footer: {
    paddingHorizontal: 22,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LINE,
    backgroundColor: NIGHT,
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
  ctaDisabled: {
    opacity: 0.55,
  },
  ctaText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  finePrint: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(196, 214, 230, 0.55)',
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  legalLink: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(196, 214, 230, 0.62)',
  },
  legalDot: {
    color: 'rgba(196, 214, 230, 0.35)',
  },
});
