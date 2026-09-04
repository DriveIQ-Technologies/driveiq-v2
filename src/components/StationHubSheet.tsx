import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
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
import { useAuth } from '@/providers/AuthProvider';
import { track, trackScreen } from '@/services/analytics';
import { showDialog } from '@/services/dialog';
import {
  formatStationLockUntil,
  isSlotActive,
  loadFreeStationSlot,
  loadSavedStations,
  setStationNotify,
  toggleSaveStation,
  type FreeStationSlot,
  type SavedStationMap,
} from '@/services/savedStations';
import {
  fetchStationLineStatuses,
  MAJOR_STATIONS,
  type MajorStation,
  type StationLineStatus,
} from '@/services/stations';
import { hasProAccess, showProPaywall } from '@/services/subscription';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '@/services/tflLines';
import { colors } from '@/theme/colors';

interface Props {
  station: MajorStation | null;
  onClose: () => void;
  /** Optional: centre the map / start navigation to this hub. */
  onNavigate?: (station: MajorStation) => void;
  /** Fired after the user's first station save (permission priming). */
  onFirstStationSaved?: () => void;
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

export function StationHubSheet({ station, onClose, onNavigate, onFirstStationSaved }: Props) {
  const { requireAccount } = useAuth();
  const [lines, setLines] = useState<StationLineStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<StationLineStatus | null>(null);
  const [savedStations, setSavedStations] = useState<SavedStationMap>({});
  const [freeSlot, setFreeSlot] = useState<FreeStationSlot | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  // Guards double taps: two overlapping writes to the same key used to leave
  // the toggles out of sync with storage.
  const [busy, setBusy] = useState<'save' | 'notify' | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!station) return;
    trackScreen('station_hub_sheet', { station_id: station.id });
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLines([]);
    hasProAccess().then((pro) => {
      if (!cancelled) setIsPremium(pro);
    });
    loadSavedStations().then((m) => {
      if (!cancelled) setSavedStations(m);
    });
    loadFreeStationSlot().then((s) => {
      if (!cancelled) setFreeSlot(s);
    });
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
  const saved = Boolean(savedStations[station.id]);
  const notify = Boolean(savedStations[station.id]?.notify);
  const savedCount = Object.keys(savedStations).length;
  const slotActive = isSlotActive(freeSlot);
  const thisIsLockedHub = slotActive && freeSlot!.stationId === station.id;
  const otherHubLocked = slotActive && freeSlot!.stationId !== station.id;
  const stationBoundaryLocked = !isPremium && !saved && (savedCount >= 1 || otherHubLocked);

  const lockedHubName =
    MAJOR_STATIONS.find((s) => s.id === freeSlot?.stationId)?.name ?? 'your saved hub';
  const lockUntilLabel =
    slotActive && freeSlot ? formatStationLockUntil(freeSlot.lockedUntil) : null;

  const explainStationLock = (slot: FreeStationSlot | null = freeSlot) => {
    const until =
      isSlotActive(slot) && slot ? formatStationLockUntil(slot.lockedUntil) : null;
    const name =
      MAJOR_STATIONS.find((s) => s.id === slot?.stationId)?.name ?? 'your saved hub';
    const message = until
      ? `You picked ${name}. That free slot is locked until ${until}. You can unsave it and turn alerts off, but you cannot switch to another hub until then — unless you upgrade.`
      : 'Free includes one saved station. Upgrade to save all seven hubs.';
    showDialog('Free hub is locked', message, [
      { label: 'OK', style: 'cancel' },
      {
        label: 'See Premium',
        onPress: () => showProPaywall('Saving more than one station', { source: 'station_hub' }),
      },
    ]);
  };

  const runSave = async () => {
    if (busy) return;
    setBusy('save');
    try {
      const res = await toggleSaveStation(station);
      if (!mountedRef.current) return;
      setSavedStations(res.map);
      setFreeSlot(res.slot);
      if (res.result === 'blocked-limit' || res.result === 'blocked-cooldown') {
        explainStationLock(res.slot);
      } else if (res.result === 'saved' && Object.keys(res.map).length === 1) {
        onFirstStationSaved?.();
      }
    } catch (e) {
      console.warn('[stations] save failed', e);
      if (mountedRef.current) {
        showDialog('Could not save', 'Please try that again in a moment.');
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const runNotify = async (next: boolean) => {
    if (busy) return;
    setBusy('notify');
    try {
      const res = await setStationNotify(station, next);
      if (!mountedRef.current) return;
      setSavedStations(res.map);
      setFreeSlot(res.slot);
      if (res.result === 'blocked-limit' || res.result === 'blocked-cooldown') {
        explainStationLock(res.slot);
      } else if (res.result === 'permission-denied') {
        showDialog(
          'Notifications are off',
          'Turn on notifications for DriveIQ in your phone settings to get alerts for this station.',
        );
      }
    } catch (e) {
      console.warn('[stations] notify failed', e);
      if (mountedRef.current) {
        showDialog('Could not update alerts', 'Please try that again in a moment.');
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const onToggleSave = () => {
    if (stationBoundaryLocked) {
      explainStationLock();
      return;
    }
    requireAccount('save', () => {
      void runSave();
    });
  };

  const onToggleNotify = () => {
    const next = !notify;
    if (stationBoundaryLocked && next) {
      explainStationLock();
      return;
    }
    requireAccount('notify', () => {
      void runNotify(next);
    });
  };

  const controlsHint = isPremium
    ? 'Premium includes every hub.'
    : thisIsLockedHub && lockUntilLabel
      ? `This is your free hub until ${lockUntilLabel}. You can turn alerts off. Switching hub needs Premium, or wait until then.`
      : otherHubLocked && lockUntilLabel
        ? `Your free hub is ${lockedHubName} until ${lockUntilLabel}.`
        : 'Free: one hub, locked for 7 days once you pick it. Premium includes every hub.';

  return (
    <SheetOverlay onRequestClose={onClose} level={2}>
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
          {stationBoundaryLocked ? (
            <Pressable
              style={styles.inlineUpgradeBar}
              onPress={explainStationLock}
              accessibilityRole="button"
            >
              <Ionicons name="lock-closed" size={15} color={colors.primaryDark} />
              <Text style={styles.inlineUpgradeText}>
                {lockUntilLabel
                  ? `Free hub is locked until ${lockUntilLabel}. Upgrade to switch hubs anytime.`
                  : 'Free saves one station. Upgrade to save all seven hubs and turn on alerts for each.'}
              </Text>
            </Pressable>
          ) : null}
          <View style={styles.controlsRow}>
            <Pressable
              onPress={onToggleSave}
              style={[
                styles.secondaryBtn,
                saved && styles.secondaryBtnActive,
                stationBoundaryLocked && styles.secondaryBtnLocked,
              ]}
              disabled={busy !== null}
              accessibilityRole="button"
            >
              {busy === 'save' ? (
                <ActivityIndicator
                  size="small"
                  color={saved ? colors.textOnPrimary : colors.primary}
                />
              ) : (
                <Ionicons
                  name={saved ? 'bookmark' : 'bookmark-outline'}
                  size={16}
                  color={saved ? colors.textOnPrimary : colors.primary}
                />
              )}
              <Text
                style={[styles.secondaryBtnText, saved && styles.secondaryBtnTextActive]}
              >
                {saved ? 'Saved station' : 'Save station'}
              </Text>
            </Pressable>
            <Pressable
              onPress={onToggleNotify}
              style={[
                styles.secondaryBtn,
                notify && styles.secondaryBtnActive,
                stationBoundaryLocked && !notify && styles.secondaryBtnLocked,
              ]}
              disabled={busy !== null}
              accessibilityRole="button"
            >
              {busy === 'notify' ? (
                <ActivityIndicator
                  size="small"
                  color={notify ? colors.textOnPrimary : colors.primary}
                />
              ) : (
                <Ionicons
                  name={notify ? 'notifications' : 'notifications-outline'}
                  size={16}
                  color={notify ? colors.textOnPrimary : colors.primary}
                />
              )}
              <Text
                style={[styles.secondaryBtnText, notify && styles.secondaryBtnTextActive]}
              >
                {notify ? 'Alerts on' : 'Notify me'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.controlsHint}>{controlsHint}</Text>
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
            Live status for every Tube, Elizabeth line, Overground and National Rail
            service that calls here.
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
    </SheetOverlay>
  );
}

const styles = StyleSheet.create({
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
  controlsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
  },
  secondaryBtnActive: {
    backgroundColor: colors.primary,
  },
  secondaryBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryBtnTextActive: {
    color: colors.textOnPrimary,
  },
  controlsHint: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginBottom: 10,
  },
  inlineUpgradeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
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
  secondaryBtnLocked: { opacity: 0.55 },
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
