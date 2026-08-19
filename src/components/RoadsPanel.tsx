import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { track, trackScreen } from '@/services/analytics';
import {
  buildCorridorBuckets,
  incidentRoadLine,
  type CorridorStatus,
} from '@/services/roadsCorridors';
import type { TrafficIncident } from '@/services/tflTraffic';
import { colors } from '@/theme/colors';

interface Props {
  visible: boolean;
  incidents: TrafficIncident[];
  onClose: () => void;
  onNavigate?: (incident: TrafficIncident) => void;
}

const statusColor: Record<CorridorStatus, string> = {
  clear: '#1E9E6A',
  slow: '#F59E0B',
  incident: '#DC2626',
};

const statusLabel: Record<CorridorStatus, string> = {
  clear: 'Clear',
  slow: 'Slow',
  incident: 'Incident',
};

export function RoadsPanel({ visible, incidents, onClose, onNavigate }: Props) {
  const [selectedCorridor, setSelectedCorridor] = useState<string | null>(null);

  const buckets = useMemo(() => buildCorridorBuckets(incidents), [incidents]);

  React.useEffect(() => {
    if (!visible) return;
    trackScreen('roads_panel');
    if (!selectedCorridor && buckets[0]) {
      setSelectedCorridor(buckets[0].corridor.id);
    }
  }, [visible, selectedCorridor, buckets]);

  if (!visible) return null;

  const active = buckets.find((b) => b.corridor.id === selectedCorridor) ?? buckets[0];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Ionicons name="car" size={22} color={colors.textOnPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Roads</Text>
            <Text style={styles.subtitle}>Live corridor status across London routes</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          {buckets.map((bucket) => {
            const selected = bucket.corridor.id === active?.corridor.id;
            const lines = bucket.incidents;
            return (
              <View key={bucket.corridor.id} style={styles.corridorBlock}>
                <Pressable
                  onPress={() => {
                    setSelectedCorridor(bucket.corridor.id);
                    track('roads_corridor_tapped', {
                      corridor: bucket.corridor.id,
                      status: bucket.status,
                      incident_count: lines.length,
                    });
                  }}
                  style={[styles.corridorRow, selected && styles.corridorRowActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: statusColor[bucket.status] },
                    ]}
                  />
                  <View style={styles.corridorText}>
                    <Text
                      style={[
                        styles.corridorLabel,
                        selected && styles.corridorLabelActive,
                      ]}
                    >
                      {bucket.corridor.label}
                    </Text>
                    <Text style={styles.corridorMeta}>
                      {statusLabel[bucket.status]}
                      {lines.length > 0
                        ? ` · ${lines.length} incident${lines.length === 1 ? '' : 's'}`
                        : ''}
                    </Text>
                  </View>
                  <Ionicons
                    name={selected ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={selected ? colors.primary : colors.textSecondary}
                  />
                </Pressable>

                {selected ? (
                  <View style={styles.incidentBlock}>
                    {lines.length === 0 ? (
                      <Text style={styles.empty}>
                        No major incidents on this corridor right now.
                      </Text>
                    ) : (
                      lines.map((inc) => (
                        <Pressable
                          key={inc.id}
                          style={styles.lineRow}
                          onPress={() => {
                            track('roads_incident_opened', {
                              corridor: bucket.corridor.id,
                              incident_id: inc.id,
                              severity: String(inc.severity),
                            });
                            onNavigate?.(inc);
                          }}
                          disabled={!onNavigate}
                          accessibilityRole="button"
                        >
                          <View
                            style={[
                              styles.lineBar,
                              {
                                backgroundColor:
                                  statusColor[inc.hasClosures ? 'incident' : 'slow'],
                              },
                            ]}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.lineText}>
                              {incidentRoadLine(inc, bucket.corridor.label)}
                            </Text>
                          </View>
                          {onNavigate ? (
                            <Ionicons
                              name="chevron-forward"
                              size={18}
                              color={colors.textSecondary}
                            />
                          ) : null}
                        </Pressable>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </View>
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
    maxHeight: '82%',
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
  body: { marginTop: 10 },
  bodyContent: { paddingBottom: 28 },
  corridorBlock: { marginBottom: 4 },
  corridorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  corridorRowActive: {
    backgroundColor: colors.primarySoft,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  corridorText: { flex: 1 },
  corridorLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  corridorLabelActive: { color: colors.primaryDark },
  corridorMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  incidentBlock: {
    marginTop: 4,
    marginLeft: 8,
    paddingLeft: 14,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  empty: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lineBar: { width: 4, height: 38, borderRadius: 2 },
  lineText: { fontSize: 14, lineHeight: 20, color: colors.textPrimary },
});
