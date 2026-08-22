import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

export interface PromptCard {
  id: string;
  label: string;
  prompt: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
}

interface Props {
  cards: PromptCard[];
  onSelect: (prompt: string) => void;
  subtitle?: string;
}

export function EmptyHero({ cards, onSelect, subtitle }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.heroMark}>
        <View style={styles.heroGlow} />
        <View style={styles.heroIcon}>
          <Ionicons name="sparkles" size={28} color={colors.textOnPrimary} />
        </View>
      </View>
      <Text style={styles.title}>How can I help?</Text>
      <Text style={styles.subtitle}>
        {subtitle ??
          'Ask about London events, roads, and travel. I use what’s live on your map right now.'}
      </Text>
      <View style={styles.grid}>
        {cards.map((card) => (
          <Pressable
            key={card.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onSelect(card.prompt)}
            accessibilityRole="button"
            accessibilityLabel={card.label}
          >
            <View style={[styles.cardIcon, { backgroundColor: `${card.tint}18` }]}>
              <Ionicons name={card.icon} size={18} color={card.tint} />
            </View>
            <Text style={styles.cardLabel}>{card.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 24,
    gap: 12,
  },
  heroMark: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heroGlow: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  title: {
    textAlign: 'center',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.textPrimary,
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '48%',
    flexGrow: 1,
    minWidth: '46%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  cardPressed: {
    backgroundColor: colors.primarySoft,
    borderColor: `${colors.primary}33`,
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
    color: colors.textPrimary,
  },
});
