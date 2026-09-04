import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { REPORT_META, type ReportCategory } from '@/services/reports';

/**
 * Map marker for a community report. A coloured teardrop with the category
 * icon — visually distinct from event pins (which are ringed bubbles) so
 * user reports never get confused with venue events.
 */
export function ReportMarker({
  category,
  confirms,
}: {
  category: ReportCategory;
  confirms?: number;
}) {
  const meta = REPORT_META[category] ?? REPORT_META.other;
  const count = confirms && confirms > 0 ? confirms : 0;
  return (
    <View style={styles.container}>
      <View style={[styles.bubble, { backgroundColor: meta.color }]}>
        <Ionicons
          name={meta.icon as React.ComponentProps<typeof Ionicons>['name']}
          size={18}
          color={colors.textOnPrimary}
        />
      </View>
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
      <View style={[styles.tail, { borderTopColor: meta.color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  tail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
