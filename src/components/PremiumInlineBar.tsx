import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { track } from '@/services/analytics';
import { showPremiumPaywall } from '@/services/subscription';
import { colors } from '@/theme/colors';

interface Props {
  message: string;
  feature: string;
  source: string;
}

/**
 * Inline upgrade bar (work order A03). Stays on the same screen; no navigation away.
 */
export function PremiumInlineBar({ message, feature, source }: Props) {
  useEffect(() => {
    track('inline_upgrade_shown', { source, feature });
  }, [source, feature]);

  const onPress = () => {
    showPremiumPaywall(feature, { source, inline: true });
  };

  return (
    <Pressable
      style={styles.bar}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={message}
    >
      <Ionicons name="lock-closed" size={16} color={colors.primaryDark} />
      <Text style={styles.text}>{message}</Text>
      <Text style={styles.cta}>Premium</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
  },
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  cta: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primaryDark,
  },
});
