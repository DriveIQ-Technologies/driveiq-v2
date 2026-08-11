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
import { StationHubSheet } from '@/components/StationHubSheet';
import { track, trackScreen } from '@/services/analytics';
import { gateStationAccess, getFreeStationId } from '@/services/stationAccess';
import { MAJOR_STATIONS, type MajorStation } from '@/services/stations';
import { hasProAccess } from '@/services/subscription';
import { colors } from '@/theme/colors';
import {
  fetchLineStatuses,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  type LineStatus,
} from '@/services/tflLines';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Optional: navigate / centre map on a major station hub. */
  onNavigateToStation?: (station: MajorStation) => void;
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
    case 'tram':
      return 'bus';
    default:
      return 'navigate';
  }
};

const modeLabel = (mode: string): string => {
  switch (mode) {
    case 'tube':
      return 'Underground';
    case 'overground':
      return 'Overground';
    case 'dlr':
      return 'DLR';
    case 'elizabeth-line':
      return 'Elizabeth line';
    case 'tram':
      return 'Tram';
    case 'national-rail':
      return 'National Rail';
    default:
      return mode;
  }
};

export function ConnectionsPanel({ visible, onClose, onNavigateToStation }: Props) {
  const [lines, setLines] = useState<LineStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Currently-open line detail popup. `null` = closed.
  const [openLine, setOpenLine] = useState<LineStatus | null>(null);
  const [openStation, setOpenStation] = useState<MajorStation | null>(null);
  // Free users get one claimed station; the rest show a padlock + Pro gate.
  const [access, setAccess] = useState<{ pro: boolean; freeId: string | null }>({
    pro: false,
    freeId: null,
  });

  useEffect(() => {
    if (!visible) return;
    trackScreen('connections_panel');
    let cancelled = false;
    Promise.all([hasProAccess(), getFreeStationId()]).then(([pro, freeId]) => {
      if (!cancelled) setAccess({ pro, freeId });
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const handleStationTap = async (station: MajorStation) => {
    const result = await gateStationAccess(station);
    track('connections_station_tapped', { station_id: station.id, gate_result: result });
    const [pro, freeId] = await Promise.all([hasProAccess(), getFreeStationId()]);
    setAccess({ pro, freeId });
    if (result === 'open') setOpenStation(station);
  };

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLineStatuses()
      .then((l) => {
        if (!cancelled) setLines(l);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Could not load line statuses');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible) return null;

  // Group lines by severity for clearer scanning.
  const groups: Record<string, LineStatus[]> = {};
  for (const l of lines) {
    (groups[l.severityBucket] ??= []).push(l);
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Ionicons name="train" size={22} color={colors.textOnPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Connections</Text>
            <Text style={styles.subtitle}>Major hubs · live tube & rail status</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 28 }}>
          <Text style={styles.hubSectionLabel}>Major stations</Text>
          <Text style={styles.hubHint}>
            Tap a terminus for every line serving it — tube, Elizabeth, Overground
            and National Rail — with live disruption status.
            {!access.pro
              ? ' Free plan includes one station of your choice; Pro unlocks all.'
              : ''}
          </Text>
          {MAJOR_STATIONS.map((s) => {
            const locked = !access.pro && access.freeId !== s.id;
            return (
              <Pressable
                key={s.id}
                style={({ pressed }) => [styles.hubRow, pressed && styles.lineRowPressed]}
                onPress={() => void handleStationTap(s)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${s.name}`}
              >
                <Ionicons name="business" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{s.name}</Text>
                  <Text style={styles.lineMode}>{s.serves}</Text>
                </View>
                {locked ? (
                  <Ionicons name="lock-closed" size={16} color={colors.featured} />
                ) : null}
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            );
          })}

          <Text style={[styles.hubSectionLabel, { marginTop: 18 }]}>All lines</Text>
          {loading && (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Loading lines…</Text>
            </View>
          )}
          {error && !loading && <Text style={styles.error}>{error}</Text>}
          {!loading &&
            !error &&
            (['closed', 'severe', 'minor', 'good'] as const).map((bucket) => {
              const items = groups[bucket];
              if (!items?.length) return null;
              return (
                <View key={bucket} style={styles.group}>
                  <View style={styles.groupHeader}>
                    <View
                      style={[styles.dot, { backgroundColor: SEVERITY_COLOR[bucket] }]}
                    />
                    <Text style={styles.groupTitle}>
                      {SEVERITY_LABEL[bucket]} · {items.length}
                    </Text>
                  </View>
                  {items.map((l) => (
                    <Pressable
                      key={`${l.modeName}-${l.id}`}
                      style={({ pressed }) => [
                        styles.lineRow,
                        pressed && styles.lineRowPressed,
                      ]}
                      onPress={() => setOpenLine(l)}
                      onPressIn={() =>
                        track('connections_line_opened', {
                          line_id: l.id,
                          severity: l.severityBucket,
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Open details for ${l.name}`}
                    >
                      <Ionicons
                        name={modeIcon(l.modeName)}
                        size={18}
                        color={colors.textSecondary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.lineName}>{l.name}</Text>
                        <Text style={styles.lineMode}>{modeLabel(l.modeName)}</Text>
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
                </View>
              );
            })}
        </ScrollView>
      </View>

      {/* Stacked detail popup — opens on top of this sheet. */}
      <LineDetailSheet
        lineId={openLine?.id ?? null}
        fallbackTitle={openLine?.name}
        subtitle={openLine ? modeLabel(openLine.modeName) : undefined}
        initialSeverity={openLine?.severityBucket}
        onClose={() => setOpenLine(null)}
      />
      <StationHubSheet
        station={openStation}
        onClose={() => setOpenStation(null)}
        onNavigate={
          onNavigateToStation
            ? (s) => {
                setOpenStation(null);
                onClose();
                onNavigateToStation(s);
              }
            : undefined
        }
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
    height: '78%',
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
  title: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  body: { marginTop: 14 },
  hubSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  hubHint: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginBottom: 8,
  },
  hubRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  loadingText: { color: colors.textSecondary },
  error: { color: colors.accent, padding: 16 },
  group: { marginBottom: 18 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.4 },
  lineRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: 8,
  },
  lineRowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  trailing: {
    alignItems: 'flex-end',
  },
  lineName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  lineMode: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  lineReason: { fontSize: 12, color: colors.textPrimary, marginTop: 6, lineHeight: 17 },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: 'flex-start',
    maxWidth: 130,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textOnPrimary,
    textAlign: 'center',
  },
});
