import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  label: string;
  color: string;
  live?: boolean;
}

export function CategoryChip({ label, color, live }: Props) {
  return (
    <View style={styles.row}>
      <View style={[styles.chip, { backgroundColor: `${color}18` }]}>
        <Text style={[styles.text, { color }]}>{label.toUpperCase()}</Text>
      </View>
      {live ? (
        <View style={styles.live}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  text: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E53935',
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#E53935',
    letterSpacing: 0.4,
  },
});
