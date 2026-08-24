import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/theme/colors';
import type { FilterChip, FilterKey } from '@/utils/dateFilters';

interface FilterBarProps {
  active: FilterKey;
  onChange: (next: FilterKey) => void;
  /** Ordered chips to render — presets followed by future-day chips. */
  chips: FilterChip[];
  /** Optional event counts per filter — rendered as "(N)" next to the label
   *  so users can see at a glance whether tapping a chip is worthwhile. */
  counts?: Partial<Record<FilterKey, number>>;
  /** Chips that need Premium to browse (lock icon). */
  lockedKeys?: FilterKey[];
}

export function FilterBar({
  active,
  onChange,
  chips,
  counts,
  lockedKeys,
}: FilterBarProps) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {chips.map(({ key, label }) => {
          const isActive = key === active;
          const count = counts?.[key];
          const locked = lockedKeys?.includes(key) ?? false;
          return (
            <Pressable
              key={key}
              onPress={() => onChange(key)}
              style={[styles.chip, isActive && styles.chipActive, locked && styles.chipLocked]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={
                count != null ? `${label}, ${count} events${locked ? ', Premium' : ''}` : label
              }
            >
              {locked ? (
                <Ionicons
                  name="lock-closed"
                  size={12}
                  color={isActive ? colors.textOnPrimary : colors.textSecondary}
                  style={styles.lockIcon}
                />
              ) : null}
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {label}
                {count != null ? (
                  <Text
                    style={[
                      styles.chipCount,
                      isActive && styles.chipCountActive,
                    ]}
                  >
                    {' '}({count})
                  </Text>
                ) : null}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
  },
  row: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  chipLocked: {
    opacity: 0.92,
  },
  lockIcon: {
    marginRight: -4,
  },
  chipText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
  chipTextActive: {
    color: colors.textOnPrimary,
  },
  chipCount: {
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chipCountActive: {
    color: colors.textOnPrimary,
    opacity: 0.85,
  },
});
