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

import { colors } from '@/theme/colors';
import {
  AIRPORTS,
  fetchAirportConnectionStatuses,
  type ConnectionStatus,
} from '@/services/airports';
import { track, trackScreen } from '@/services/analytics';
import { LineDetailSheet } from '@/components/LineDetailSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  onPickAirport?: (lat: number, lon: number) => void;
  onNavigate?: (airport: { id: string; name: string; latitude: number; longitude: number }) => void;
}

const SEVERITY_COLOR: Record<ConnectionStatus['severityBucket'], string> = {
  good: '#26C281',
  minor: '#FACC15',
  severe: '#F97316',
  closed: '#DC2626',
};

export function AirportsPanel({ visible, onClose, onPickAirport, onNavigate }: Props) {
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openConn, setOpenConn] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    if (!visible) return;
    trackScreen('airports_panel');
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAirportConnectionStatuses()
      .then((s) => {
        if (!cancelled) setStatuses(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Could not load airport statuses');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Ionicons name="airplane" size={22} color={colors.textOnPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>London airports</Text>
            <Text style={styles.subtitle}>Live rail-link status</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 28 }}>
          {loading && (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          )}
          {error && !loading && <Text style={styles.error}>{error}</Text>}
          {!loading &&
            !error &&
            AIRPORTS.map((airport) => {
              const conns = statuses[airport.id] ?? [];
              return (
                <View key={airport.id} style={styles.airport}>
                  <Pressable
                    onPress={() => {
                      track('airport_selected_from_panel', { airport_id: airport.id });
                      onPickAirport?.(airport.latitude, airport.longitude);
                      onClose();
                    }}
                    style={styles.airportHeader}
                    accessibilityRole="button"
                  >
                    <View>
                      <Text style={styles.airportName}>{airport.name}</Text>
                      <Text style={styles.airportIata}>{airport.iata}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                  </Pressable>

                  {onNavigate ? (
                    <Pressable
                      onPress={() => {
                        track('airport_navigate_tapped', {
                          airport_id: airport.id,
                          source: 'airports_panel',
                        });
                        onNavigate({
                          id: airport.id,
                          name: airport.name,
                          latitude: airport.latitude,
                          longitude: airport.longitude,
                        });
                      }}
                      style={styles.directionsBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Get directions to ${airport.name}`}
                    >
                      <Ionicons
                        name="navigate"
                        size={15}
                        color={colors.textOnPrimary}
                      />
                      <Text style={styles.directionsText}>Get directions</Text>
                    </Pressable>
                  ) : null}

                  {conns.length === 0 ? (
                    <Text style={styles.empty}>No connection data.</Text>
                  ) : (
                    conns.map((c) => (
                      <Pressable
                        key={c.lineId}
                        style={({ pressed }) => [
                          styles.connRow,
                          pressed && styles.connRowPressed,
                        ]}
                        onPress={() => setOpenConn(c)}
                        onPressIn={() =>
                          track('airport_connection_line_opened', {
                            airport_id: airport.id,
                            line_id: c.lineId,
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Open details for ${c.label}`}
                      >
                        <Ionicons name="train" size={16} color={colors.textSecondary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.connLabel}>{c.label}</Text>
                          {c.note ? <Text style={styles.connNote}>{c.note}</Text> : null}
                          {c.reason ? (
                            <Text style={styles.connReason} numberOfLines={2}>
                              {c.reason.replace(/https?:\/\/\S+/gi, '').trim() ||
                                'Tap for full details'}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.connTrailing}>
                          <View
                            style={[
                              styles.statusPill,
                              { backgroundColor: SEVERITY_COLOR[c.severityBucket] },
                            ]}
                          >
                            <Text style={styles.statusText}>{c.statusDescription}</Text>
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color={colors.textSecondary}
                            style={{ marginTop: 4 }}
                          />
                        </View>
                      </Pressable>
                    ))
                  )}
                </View>
              );
            })}
        </ScrollView>
      </View>

      <LineDetailSheet
        lineId={openConn?.lineId ?? null}
        fallbackTitle={openConn?.label}
        subtitle={openConn?.note}
        initialSeverity={openConn?.severityBucket}
        onClose={() => setOpenConn(null)}
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
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  loadingText: { color: colors.textSecondary },
  error: { color: colors.accent, padding: 16 },
  airport: {
    marginBottom: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  airportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  airportName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  airportIata: { fontSize: 12, color: colors.textSecondary, marginTop: 2, letterSpacing: 1 },
  empty: { color: colors.textSecondary, fontSize: 13 },
  connRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderRadius: 8,
  },
  connRowPressed: {
    backgroundColor: colors.surface,
  },
  connTrailing: {
    alignItems: 'flex-end',
  },
  connLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  connNote: { fontSize: 11, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
  connReason: { fontSize: 12, color: colors.textPrimary, marginTop: 6, lineHeight: 17 },
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
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  directionsText: {
    color: colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
});
