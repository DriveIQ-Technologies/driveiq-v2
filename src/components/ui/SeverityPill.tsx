import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  type LineSeverityBucket,
} from '@/services/tflLines';
import { colors } from '@/theme/colors';

/**
 * The coloured status badge on every line row. Always the short label
 * ("Minor disruption"), never the operator's message: National Rail puts a
 * whole sentence in its status, which turned the pill into a yellow blob.
 * The message itself goes in the row text below the line name.
 */
export function SeverityPill({ bucket }: { bucket: LineSeverityBucket }) {
  return (
    <View style={[styles.pill, { backgroundColor: SEVERITY_COLOR[bucket] }]}>
      <Text
        style={[styles.text, bucket === 'minor' && styles.textOnYellow]}
        numberOfLines={1}
      >
        {SEVERITY_LABEL[bucket]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textOnPrimary,
    textAlign: 'center',
  },
  // White on yellow is unreadable in daylight.
  textOnYellow: { color: colors.textPrimary },
});
