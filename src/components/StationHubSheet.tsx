import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { LineDetailSheet } from '@/components/LineDetailSheet';
import { track, trackScreen } from '@/services/analytics';
import {
  fetchStationLineStatuses,
  type MajorStation,
  type StationLineStatus,
} from '@/services/stations';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '@/services/tflLines';
import { colors } from '@/theme/colors';

interface Props {
  station: MajorStation | null;
  onClose: () => void;
  /** Optional: centre the map / start navigation to this hub. */
  onNavigate?: (station: MajorStation) => void;
}

const modeIcon = (mode: string): React.ComponentProps<typeof Ionicons>['name'] => {
  switch (mode) {
    case 'tube':
      return 'subway';
    case 'overground':
    case 'national-rail':
      return 'train';
    case 'dlr':
      return 'git-network';
    case 'elizabeth-line':
      return 'flash';
    default:
      return 'navigate';
  }
};

export function StationHubSheet({ station, onClose, onNavigate }: Props) {
  const [lines, setLines] = useState<StationLineStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<StationLineStatus | null>(null);

  useEffect(() => {
    if (!station) return;
    trackScreen('station_hub_sheet', { station_id: station.id });
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLines([]);
    fetchStationLineStatuses(station)
      .then((l) => {
        if (!cancelled) setLines(l);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Could not load station lines');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [station]);

  if (!station) return null;

  const disrupted = lines.filter((l) => l.severityBucket !== 'good').length;

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Ionicons name="business" size={22} color={colors.textOnPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{station.name}</Text>
            <Text style={styles.subtitle}>{station.serves}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 28 }}>
          {onNavigate ? (
            <Pressable
              onPress={() => {
                track('station_hub_directions_tapped', { station_id: station.id });
                onNavigate(station);
              }}
              style={styles.directionsBtn}
              accessibilityRole="button"
              accessibilityLabel={`Get directions to ${station.name}`}
            >
              <Ionicons name="navigate" size={15} color={colors.textOnPrimary} />
              <Text style={styles.directionsText}>Get directions</Text>
            </Pressable>
          ) : null}

          <Text style={styles.sectionLabel}>
            Lines serving this station
            {!loading && lines.length > 0
              ? ` · ${lines.length}${disrupted ? ` · ${disrupted} disrupted` : ''}`
              : ''}
          </Text>
          <Text style={styles.hint}>
            Live status for every tube, Elizabeth, Overground and National Rail
            service that calls here — not a copy of the national operator list.
          </Text>

          {loading && (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Loading lines…</Text>
            </View>
          )}
          {error && !loading && <Text style={styles.error}>{error}</Text>}
          {!loading && !error && lines.length === 0 && (
            <Text style={styles.empty}>No live line data for this hub right now.</Text>
          )}

          {!loading &&
            lines.map((l) => (
              <Pressable
                key={`${l.modeName}-${l.id}`}
                style={({ pressed }) => [styles.lineRow, pressed && styles.lineRowPressed]}
                onPress={() => setOpenLine(l)}
                onPressIn={() =>
                  track('station_hub_line_opened', {
                    station_id: station.id,
                    line_id: l.id,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Open details for ${l.displayName}`}
              >
                <Ionicons
                  name={modeIcon(l.modeName)}
                  size={18}
                  color={colors.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{l.displayName}</Text>
                  <Text style={styles.lineMode}>{SEVERITY_LABEL[l.severityBucket]}</Text>
                  {l.reason ? (
                    <Text style={styles.lineReason} numberOfLines={2}>
                      {l.reason.replace(/https?:\/\/\S+/gi, '').trim() ||
                        'Tap for full details'}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.trailing}>
                  <View
                    style={[
                      styles.statusPill,
                      { backgroundColor: SEVERITY_COLOR[l.severityBucket] },
                    ]}
                  >
                    <Text style={styles.statusText}>{l.statusDescription}</Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textSecondary}
                    style={{ marginTop: 6 }}
                  />
                </View>
              </Pressable>
            ))}
        </ScrollView>
      </View>

      <LineDetailSheet
        lineId={openLine?.id ?? null}
        fallbackTitle={openLine?.displayName}
        initialSeverity={openLine?.severityBucket}
        onClose={() => setOpenLine(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  body: { marginTop: 12 },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 10,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  directionsText: { color: colors.textOnPrimary, fontSize: 14, fontWeight: '700' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginBottom: 10,
  },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  loadingText: { color: colors.textSecondary },
  error: { color: colors.accent, paddingVertical: 14 },
  empty: { color: colors.textSecondary, paddingVertical: 12 },
  lineRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineRowPressed: { backgroundColor: colors.surfaceMuted },
  lineName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  lineMode: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  lineReason: { fontSize: 12, color: colors.textPrimary, marginTop: 6, lineHeight: 17 },
  trailing: { alignItems: 'flex-end' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, maxWidth: 120 },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textOnPrimary,
    textAlign: 'center',
  },
});
