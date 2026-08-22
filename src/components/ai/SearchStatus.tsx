import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

const STEPS = [
  'Searching venues…',
  'Checking event sources…',
  'Comparing dates…',
  'Building your London guide…',
];

export function SearchStatus() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 900);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.pulse}>
          <Ionicons name="sparkles" size={14} color={colors.primary} />
        </View>
        <Text style={styles.headline}>Thinking…</Text>
      </View>
      <Text style={styles.step}>{STEPS[step]}</Text>
      <View style={styles.dots}>
        {STEPS.map((_, i) => (
          <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pulse: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  step: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 34,
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
    marginLeft: 34,
    marginTop: 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 14,
  },
});
