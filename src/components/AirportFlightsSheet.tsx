import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { LineDetailSheet } from '@/components/LineDetailSheet';
import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { showDialog } from '@/services/dialog';
import { useAuth } from '@/providers/AuthProvider';
import type { Airport, ConnectionStatus } from '@/services/airports';
import { fetchAirportConnectionStatuses } from '@/services/airports';
import {
  fetchAirportFlights,
  type AirportFlight,
  type FlightDirection,
} from '@/services/aerodatabox';
import {
  loadSavedFlights,
  saveFlight,
  unsaveFlight,
  type SavedFlightMap,
} from '@/services/savedFlights';
import { track, trackScreen } from '@/services/analytics';
import { hasProAccess, showPremiumPaywall } from '@/services/subscription';
import { colors } from '@/theme/colors';
import { ensurePermission, loadPrefs } from '@/services/notifications';

interface Props {
  airport: Airport | null;
  onClose: () => void;
  onNavigate?: (airport: Airport) => void;
}

// Tier limits (work order Part A): free = 3h board + 1 watched flight.
// Premium = full day board + unlimited watched flights.
const FREE_WINDOW_HOURS = 3;
const FREE_WATCH_LIMIT = 1;

const SEVERITY_COLOR: Record<ConnectionStatus['severityBucket'], string> = {
  good: '#26C281',
  minor: '#FACC15',
  severe: '#F97316',
  closed: '#DC2626',
};

/** "2026-06-26 08:05+01:00" | "2026-06-26T08:05+01:00" -> "08:05". */
function hhmm(local?: string): string {
  if (!local) return '--:--';
  const sep = local.includes('T') ? 'T' : ' ';
  const time = local.split(sep)[1] ?? '';
  return time.slice(0, 5) || '--:--';
}

// Left status bar colour: red cancelled, amber delayed, green otherwise.
function flightBarColor(f: AirportFlight): string {
  if (f.cancelled) return '#DC2626';
  if (f.delayed) return '#F97316';
  return '#26C281';
}
function flightStatusText(f: AirportFlight): string {
  if (f.cancelled) return '#DC2626';
  if (f.delayed) return '#F97316';
  return '#1E9E6A';
}
function flightStatusBg(f: AirportFlight): string {
  if (f.cancelled) return '#FCEBEB';
  if (f.delayed) return '#FAEEDA';
  return '#E1F5EE';
}
const STATUS_LABELS: Record<string, string> = {
  EnRoute: 'En route',
  CheckIn: 'Check-in',
  Departed: 'Departed',
  Arrived: 'Arrived',
  Boarding: 'Boarding',
  Expected: 'Expected',
  Scheduled: 'Scheduled',
  Diverted: 'Diverted',
  Approaching: 'Approaching',
};
function flightStatusLabel(f: AirportFlight): string {
  if (f.cancelled) return 'Cancelled';
  if (f.delayed) return f.delayMinutes != null ? `Delayed ${f.delayMinutes}m` : 'Delayed';
  return STATUS_LABELS[f.status] ?? f.status;
}

export function AirportFlightsSheet({ airport, onClose, onNavigate }: Props) {
  const { requireAccount } = useAuth();
  const [conns, setConns] = useState<ConnectionStatus[]>([]);
  const [connsLoading, setConnsLoading] = useState(false);
  const [openConn, setOpenConn] = useState<ConnectionStatus | null>(null);

  const [flights, setFlights] = useState<AirportFlight[]>([]);
  const [flightsLoading, setFlightsLoading] = useState(false);
  const [flightsError, setFlightsError] = useState<string | null>(null);
  const [direction, setDirection] = useState<FlightDirection>('departure');
  const [isPro, setIsPro] = useState(false);
  const [saved, setSaved] = useState<SavedFlightMap>({});
  const [selectedFlight, setSelectedFlight] = useState<AirportFlight | null>(null);

  useEffect(() => {
    hasProAccess().then(setIsPro);
    loadSavedFlights().then(setSaved);
  }, []);

  useEffect(() => {
    if (!airport) return;
    trackScreen('airport_flights_sheet', { airport_id: airport.id });
  }, [airport]);

  // Rail-link statuses for this airport (same source as the sidebar Airports tab).
  useEffect(() => {
    if (!airport) return;
    let cancelled = false;
    setConnsLoading(true);
    setConns([]);
    fetchAirportConnectionStatuses()
      .then((byAirport) => {
        if (!cancelled) setConns(byAirport[airport.id] ?? []);
      })
      .catch(() => {
        if (!cancelled) setConns([]);
      })
      .finally(() => {
        if (!cancelled) setConnsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [airport]);

  // Live flights for this airport. Premium always gets the full local day.
  useEffect(() => {
    if (!airport) return;
    let cancelled = false;
    setFlightsLoading(true);
    setFlightsError(null);
    setFlights([]);
    fetchAirportFlights(airport.id, new Date(), { fullDay: isPro })
      .then((res) => {
        if (cancelled) return;
        setFlights(res.flights);
        if (res.error === 'no-key') {
          setFlightsError('Live flights need an AeroDataBox API key (set EXPO_PUBLIC_AERODATABOX_API_KEY).');
        } else if (res.error === 'rate-limited') {
          setFlightsError('Flight data is rate limited right now. Try again shortly.');
        } else if (res.error === 'http') {
          if (res.status === 401 || res.status === 403) {
            setFlightsError(
              'AeroDataBox rejected the request (HTTP ' +
                res.status +
                '). The RapidAPI key likely isn’t subscribed to AeroDataBox, or your plan doesn’t include the airport flights endpoint. Subscribe to AeroDataBox on RapidAPI and try again.',
            );
          } else if (res.status === 404) {
            setFlightsError('Flights endpoint not found (404). The airport code or request format needs a tweak.');
          } else {
            setFlightsError('Couldn’t load flights (HTTP ' + (res.status ?? '?') + '). Open again to retry.');
          }
        } else if (res.error === 'network') {
          setFlightsError('Couldn’t reach the flights service. Check your connection and open again.');
        }
      })
      .catch(() => {
        if (!cancelled) setFlightsError('Couldn’t load flights.');
      })
      .finally(() => {
        if (!cancelled) setFlightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [airport, isPro]);

  // Only relevant flights: drop anything more than 30 min in the past so we
  // never show flights that left/landed hours ago. Sorted soonest-first.
  const [shownFlights, lockedFlights] = useMemo(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    const list = flights
      .filter((f) => f.direction === direction)
      .filter((f) => f.scheduledMs === 0 || f.scheduledMs >= cutoff);
    if (isPro) return [list, []] as const;
    const horizon = Date.now() + FREE_WINDOW_HOURS * 60 * 60 * 1000;
    const visible = list.filter((f) => f.scheduledMs === 0 || f.scheduledMs <= horizon);
    const locked = list.filter((f) => f.scheduledMs > horizon);
    return [visible, locked] as const;
  }, [flights, direction, isPro]);

  const boundaryTracked = useRef(false);
  useEffect(() => {
    if (isPro || lockedFlights.length === 0 || boundaryTracked.current || !airport) return;
    boundaryTracked.current = true;
    track('three_hour_boundary_reached', {
      airport_id: airport.id,
      locked_count: lockedFlights.length,
    });
  }, [isPro, lockedFlights.length, airport]);

  if (!airport) return null;

  const upgrade = () =>
    showPremiumPaywall('Full-day arrivals and unlimited watched flights', {
      source: 'airport_flights',
      inline: true,
    });

  const toggleSave = async (f: AirportFlight) => {
    const hasAccount = requireAccount('watched_flight', () => {
      void (async () => {
        if (saved[f.id]) {
          const next = await unsaveFlight(f.id);
          setSaved(next);
          track('flight_unsaved', {
            airport_id: airport.id,
            flight_id: f.id,
            direction: f.direction,
          });
          return;
        }

        // Enforce the watch quota before saving.
        const watchedCount = Object.keys(saved).length;
        if (!isPro && watchedCount >= FREE_WATCH_LIMIT) {
          track('flight_save_blocked_limit', { tier: 'free', watched_count: watchedCount });
          showDialog(
            'Flight watch limit',
            `Free tracks ${FREE_WATCH_LIMIT} flight at a time. Upgrade to DriveIQ Premium to watch unlimited flights, or stop watching your current one first.`,
            [
              { label: 'Not now', style: 'cancel' },
              { label: 'See Premium', onPress: upgrade },
            ],
          );
          return;
        }

        await ensurePermission();
        const prefs = await loadPrefs();
        if (!prefs['saved-flights']) {
          showDialog(
            'Flight alerts off',
            'Turn on “Watched flights” in Notification settings to get delay and cancel pings.',
          );
        }
        const next = await saveFlight(airport.id, f);
        setSaved(next);
        track('flight_saved', {
          airport_id: airport.id,
          flight_id: f.id,
          direction: f.direction,
        });
        showDialog(
          'Watching flight',
          `${f.flightNumber}. We will ping you if it is delayed or cancelled.`,
        );
      })();
    });
    if (!hasAccount) {
      // Close the detail card so the account prompt is the obvious next step.
      setSelectedFlight(null);
    }
  };

  return (
    <SheetOverlay onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Ionicons name="airplane" size={22} color={colors.textOnPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{airport.name}</Text>
            <Text style={styles.subtitle}>{airport.iata} · Rail links & live flights</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 28 }}>
          {onNavigate ? (
            <Pressable
              onPress={() => onNavigate(airport)}
              style={styles.directionsBtn}
              accessibilityRole="button"
              accessibilityLabel={`Get directions to ${airport.name}`}
            >
              <Ionicons name="navigate" size={15} color={colors.textOnPrimary} />
              <Text style={styles.directionsText}>Get directions</Text>
            </Pressable>
          ) : null}

          {/* ── Rail links (live, same data as the sidebar Airports tab) ── */}
          <Text style={styles.sectionLabel}>Rail links</Text>
          {connsLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Loading status…</Text>
            </View>
          ) : conns.length === 0 ? (
            <Text style={styles.empty}>No rail-link data right now.</Text>
          ) : (
            conns.map((c) => (
              <Pressable
                key={c.lineId}
                style={({ pressed }) => [styles.connRow, pressed && styles.connRowPressed]}
                onPress={() => setOpenConn(c)}
                accessibilityRole="button"
                accessibilityLabel={`Open details for ${c.label}`}
              >
                <Ionicons name="train" size={16} color={colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.connLabel}>{c.label}</Text>
                  {c.note ? <Text style={styles.connNote}>{c.note}</Text> : null}
                  {c.reason ? (
                    <Text style={styles.connReason} numberOfLines={2}>
                      {c.reason.replace(/https?:\/\/\S+/gi, '').trim() || 'Tap for full details'}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.connTrailing}>
                  <View style={[styles.statusPill, { backgroundColor: SEVERITY_COLOR[c.severityBucket] }]}>
                    <Text style={styles.statusText}>{c.statusDescription}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} style={{ marginTop: 4 }} />
                </View>
              </Pressable>
            ))
          )}

          {/* ── Live flights ── */}
          <Pressable style={styles.proBanner} onPress={upgrade} accessibilityRole="button">
            <Ionicons name="star" size={16} color={colors.primaryDark} />
            <View style={{ flex: 1 }}>
              <Text style={styles.proTitle}>
                {isPro ? 'DriveIQ Premium' : 'DriveIQ Premium'}
              </Text>
              <Text style={styles.proBody}>
                {isPro
                  ? 'Full-day arrivals and departures with unlimited watched flights.'
                  : `Free: next ${FREE_WINDOW_HOURS}h with ${FREE_WATCH_LIMIT} watched flight. Premium: full day with unlimited watched flights.`}
              </Text>
            </View>
            {!isPro ? (
              <View style={styles.proCta}>
                <Text style={styles.proCtaText}>Upgrade</Text>
              </View>
            ) : null}
          </Pressable>

          <View style={styles.segment}>
            {(['departure', 'arrival'] as FlightDirection[]).map((d) => {
              const active = direction === d;
              return (
                <Pressable
                  key={d}
                  onPress={() => {
                    track('flights_direction_changed', {
                      airport_id: airport.id,
                      direction: d,
                    });
                    setDirection(d);
                  }}
                  style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {d === 'departure' ? 'Departures' : 'Arrivals'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {flightsLoading && (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Loading flights…</Text>
            </View>
          )}

          {!flightsLoading && flightsError && <Text style={styles.error}>{flightsError}</Text>}

          {!flightsLoading && !flightsError && shownFlights.length === 0 && (
            <Text style={styles.empty}>
              No {direction === 'departure' ? 'departures' : 'arrivals'}{' '}
              {isPro
                ? 'in this window.'
                : `in the next ${FREE_WINDOW_HOURS} hours. Premium shows the full day.`}
            </Text>
          )}

          {!flightsLoading &&
            shownFlights.map((f) => {
              const watching = !!saved[f.id];
              return (
                <Pressable
                  key={f.id}
                  style={({ pressed }) => [
                    styles.flightRow,
                    pressed && styles.flightRowPressed,
                  ]}
                  onPress={() => {
                    track('flight_row_opened', {
                      airport_id: airport.id,
                      flight_id: f.id,
                      direction: f.direction,
                    });
                    setSelectedFlight(f);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.flightNumber} ${flightStatusLabel(f)}`}
                >
                  <View style={[styles.flightBar, { backgroundColor: flightBarColor(f) }]} />
                  <View style={styles.timeCol}>
                    <Text
                      style={[
                        styles.time,
                        (f.cancelled || f.delayed) && styles.timeStruck,
                      ]}
                    >
                      {hhmm(f.scheduledLocal)}
                    </Text>
                    {f.cancelled ? (
                      <Text style={styles.subCancelled}>Cancelled</Text>
                    ) : f.delayed && f.revisedLocal ? (
                      <Text style={styles.subDelayed}>Est. {hhmm(f.revisedLocal)}</Text>
                    ) : (
                      <Text style={styles.subSched}>Sched.</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.route} numberOfLines={1}>
                      {direction === 'departure' ? 'To ' : 'From '}
                      {f.counterpart}
                      {f.counterpartIata ? ` (${f.counterpartIata})` : ''}
                    </Text>
                    <Text style={styles.flightMeta} numberOfLines={1}>
                      {f.flightNumber}
                      {f.airline ? ` · ${f.airline}` : ''}
                      {f.terminal ? ` · T${f.terminal}` : ''}
                    </Text>
                  </View>
                  <View style={styles.flightTrailing}>
                    <View
                      style={[styles.flightStatusPill, { backgroundColor: flightStatusBg(f) }]}
                    >
                      <Text style={[styles.flightStatusText, { color: flightStatusText(f) }]}>
                        {flightStatusLabel(f)}
                      </Text>
                    </View>
                    <Ionicons
                      name={watching ? 'bookmark' : 'bookmark-outline'}
                      size={16}
                      color={watching ? colors.primary : colors.textSecondary}
                      style={{ marginTop: 6 }}
                    />
                  </View>
                </Pressable>
              );
            })}

          {!isPro && lockedFlights.length > 0 ? (
            <>
              <Pressable
                style={styles.inlineUpgradeBar}
                onPress={upgrade}
                accessibilityRole="button"
              >
                <Ionicons name="lock-closed" size={15} color={colors.primaryDark} />
                <Text style={styles.inlineUpgradeText}>
                  Another {lockedFlights.length}{' '}
                  {direction === 'arrival' ? 'arrivals' : 'departures'} today.
                  See the full day and watch as many flights as you like.
                </Text>
              </Pressable>
              {lockedFlights.map((f) => (
                <View key={`locked-${f.id}`} style={[styles.flightRow, styles.flightRowLocked]}>
                  <View style={[styles.flightBar, { backgroundColor: colors.border }]} />
                  <View style={styles.timeCol}>
                    <Text style={styles.timeLocked}>--:--</Text>
                    <Text style={styles.subSched}>Premium</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeLocked}>Locked on free plan</Text>
                    <Text style={styles.flightMeta} numberOfLines={1}>
                      Upgrade to view this row
                    </Text>
                  </View>
                  <View style={styles.flightTrailing}>
                    <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
                  </View>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      </View>

      <LineDetailSheet
        lineId={openConn?.lineId ?? null}
        fallbackTitle={openConn?.label}
        subtitle={openConn?.note}
        initialSeverity={openConn?.severityBucket}
        onClose={() => setOpenConn(null)}
      />

      {selectedFlight ? (
        <SheetOverlay onRequestClose={() => setSelectedFlight(null)}>
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>{selectedFlight.flightNumber}</Text>
            <Text style={styles.detailBody}>
              {selectedFlight.direction === 'departure' ? 'To' : 'From'}{' '}
              {selectedFlight.counterpart}
              {selectedFlight.counterpartIata
                ? ` (${selectedFlight.counterpartIata})`
                : ''}
            </Text>
            <Text style={styles.detailMeta}>
              {selectedFlight.airline || 'Airline TBA'}
              {selectedFlight.terminal ? ` · Terminal ${selectedFlight.terminal}` : ''}
            </Text>
            <Text style={styles.detailMeta}>
              Scheduled {hhmm(selectedFlight.scheduledLocal)}
              {selectedFlight.revisedLocal
                ? ` · Revised ${hhmm(selectedFlight.revisedLocal)}`
                : ''}
            </Text>
            <Text
              style={[
                styles.detailStatus,
                { color: flightStatusText(selectedFlight) },
              ]}
            >
              {flightStatusLabel(selectedFlight)}
            </Text>
            <Pressable
              style={styles.watchBtn}
              onPress={() => {
                void toggleSave(selectedFlight);
              }}
              accessibilityRole="button"
            >
              <Ionicons
                name={saved[selectedFlight.id] ? 'bookmark' : 'bookmark-outline'}
                size={18}
                color={colors.textOnPrimary}
              />
              <Text style={styles.watchBtnText}>
                {saved[selectedFlight.id] ? 'Stop watching' : 'Watch for delays'}
              </Text>
            </Pressable>
            <Pressable onPress={() => setSelectedFlight(null)} style={styles.detailClose}>
              <Text style={styles.detailCloseText}>Close</Text>
            </Pressable>
          </View>
        </SheetOverlay>
      ) : null}
    </SheetOverlay>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '82%',
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
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2, letterSpacing: 0.3 },
  body: { marginTop: 12 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 6,
  },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  directionsText: { color: colors.textOnPrimary, fontSize: 14, fontWeight: '700' },
  connRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  connRowPressed: { backgroundColor: colors.surfaceMuted },
  connTrailing: { alignItems: 'flex-end' },
  connLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  connNote: { fontSize: 11, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
  connReason: { fontSize: 12, color: colors.textPrimary, marginTop: 6, lineHeight: 17 },
  proBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.featured,
  },
  proTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  proBody: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  proCta: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.primary },
  proCtaText: { color: colors.textOnPrimary, fontWeight: '800', fontSize: 12 },
  segment: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    padding: 4,
  },
  segmentBtn: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: colors.primary },
  segmentText: { fontWeight: '700', color: colors.textSecondary, fontSize: 13 },
  segmentTextActive: { color: colors.textOnPrimary },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  loadingText: { color: colors.textSecondary },
  error: { color: colors.accent, paddingVertical: 14, lineHeight: 20 },
  empty: { color: colors.textSecondary, paddingVertical: 12 },
  flightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  flightRowPressed: { backgroundColor: colors.surfaceMuted },
  flightBar: { width: 4, height: 40, borderRadius: 2 },
  timeCol: { width: 58 },
  time: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  timeStruck: { textDecorationLine: 'line-through', color: colors.textSecondary },
  subDelayed: { fontSize: 11, fontWeight: '700', color: '#F97316', marginTop: 2 },
  subCancelled: { fontSize: 11, fontWeight: '700', color: '#DC2626', marginTop: 2 },
  subSched: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  route: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  flightMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  flightTrailing: { alignItems: 'flex-end' },
  inlineUpgradeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.featured,
  },
  inlineUpgradeText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
    lineHeight: 17,
  },
  flightRowLocked: { opacity: 0.52 },
  timeLocked: { fontSize: 16, fontWeight: '800', color: colors.textSecondary },
  routeLocked: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  flightStatusPill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    maxWidth: 110,
  },
  flightStatusText: { fontSize: 11, fontWeight: '800', textAlign: 'center' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, maxWidth: 120 },
  statusText: { fontSize: 11, fontWeight: '800', color: colors.textOnPrimary, textAlign: 'center' },
  detailCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: '28%',
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 18,
  },
  detailTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  detailBody: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginTop: 6 },
  detailMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 6 },
  detailStatus: { fontSize: 14, fontWeight: '800', marginTop: 10 },
  watchBtn: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },
  watchBtnText: { color: colors.textOnPrimary, fontWeight: '800', fontSize: 14 },
  detailClose: { alignItems: 'center', marginTop: 12, paddingVertical: 8 },
  detailCloseText: { color: colors.textSecondary, fontWeight: '600' },
});
