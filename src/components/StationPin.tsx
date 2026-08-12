import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { MajorStation } from '@/services/stations';
import { colors } from '@/theme/colors';

interface StationPinProps {
  station: MajorStation;
  onPress: (station: MajorStation) => void;
  /** Bumped after each map gesture — re-rasterises a pin whose frozen bitmap
   *  came out blank or clipped (same self-heal as AirportPin / EventPin). */
  rasterEpoch?: number;
}

const STATION_GREEN = '#0F7A5C';

/**
 * Map pin for a major rail terminus (Paddington / Euston / King's Cross…).
 * Deep green with a train glyph so hubs read differently from the navy
 * airport pins at a glance.
 *
 * Emoji (not icon-font glyphs) so the marker paints on first rasterise; we
 * track view changes briefly on mount then freeze to a static bitmap.
 */
function StationPinBase({ station, onPress, rasterEpoch = 0 }: StationPinProps) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setTracks(false), 700);
    return () => clearTimeout(id);
  }, []);

  const firstEpoch = useRef(true);
  useEffect(() => {
    if (firstEpoch.current) {
      firstEpoch.current = false;
      return;
    }
    setTracks(true);
    const id = setTimeout(() => setTracks(false), 350);
    return () => clearTimeout(id);
  }, [rasterEpoch]);

  return (
    <Marker
      coordinate={{ latitude: station.latitude, longitude: station.longitude }}
      onPress={() => onPress(station)}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracks}
      // Termini sit in the densest part of the map — keep above event pins,
      // just under airports.
      zIndex={19}
    >
      <View style={styles.container}>
        <View style={styles.bubble}>
          <Text style={styles.train}>🚆</Text>
        </View>
        <View style={styles.tail} />
      </View>
    </Marker>
  );
}

export const StationPin = React.memo(
  StationPinBase,
  (prev, next) =>
    prev.station.id === next.station.id &&
    prev.onPress === next.onPress &&
    prev.rasterEpoch === next.rasterEpoch,
);

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  bubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    borderColor: colors.surface,
    backgroundColor: STATION_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  train: { fontSize: 17, textAlign: 'center' },
  tail: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: STATION_GREEN,
  },
});
