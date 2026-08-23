import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { colors } from '@/theme/colors';
import { track, trackScreen } from '@/services/analytics';
import {
  fetchLineDetail,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  type LineDetail,
  type LineSeverityBucket,
} from '@/services/tflLines';

interface Props {
  /** TfL line id to load (e.g. "victoria", "elizabeth", "thameslink"). */
  lineId: string | null;
  /** Header text — falls back to the fetched line name once loaded. */
  fallbackTitle?: string;
  /** Subtitle under the title (e.g. "Underground" or "Heathrow Express"). */
  subtitle?: string;
  /** Optional pre-known severity so we can colour the header before the
   *  detail request resolves. */
  initialSeverity?: LineSeverityBucket;
  onClose: () => void;
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

const formatTimestamp = (ms: number): string => {
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
};

/**
 * Tap-through detail for a single TfL line / airport rail connection.
 *
 * Shows the full disruption text, the list of affected stations, the
 * operator's live service-disruption page (opened in-app), a last-updated
 * timestamp, and pull-to-refresh.
 */
export function LineDetailSheet({
  lineId,
  fallbackTitle,
  subtitle,
  initialSeverity,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!lineId) return;
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const next = await fetchLineDetail(lineId);
        if (!next) {
          setError('Could not load this line.');
        } else {
          setDetail(next);
        }
      } catch (e: unknown) {
        setError((e as Error)?.message ?? 'Network error');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [lineId],
  );

  useEffect(() => {
    if (!lineId) {
      setDetail(null);
      setError(null);
      return;
    }
    trackScreen('line_detail_sheet', { line_id: lineId });
    load('initial');
  }, [lineId, load]);

  if (!lineId) return null;

  const severity = detail?.severityBucket ?? initialSeverity ?? 'good';
  const title = detail?.name ?? fallbackTitle ?? 'Line status';
  const modeName = detail?.modeName ?? '';

  return (
    <SheetOverlay onRequestClose={onClose} level={3}>
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.headerRow}>
          <View
            style={[
              styles.headerIcon,
              { backgroundColor: SEVERITY_COLOR[severity] },
            ]}
          >
            <Ionicons
              name={modeIcon(modeName)}
              size={22}
              color={colors.textOnPrimary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Status pill row */}
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: SEVERITY_COLOR[severity] },
            ]}
          >
            <Text style={styles.statusText}>
              {detail?.statusDescription ?? SEVERITY_LABEL[severity]}
            </Text>
          </View>
          {detail ? (
            <Text style={styles.timestamp}>
              Updated {formatTimestamp(detail.fetchedAt)}
            </Text>
          ) : null}
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={{ paddingBottom: 28 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={colors.primary}
            />
          }
        >
          {loading && !detail && (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Loading details…</Text>
            </View>
          )}

          {error && !loading && <Text style={styles.error}>{error}</Text>}

          {detail && (
            <>
              {/* Disruptions */}
              {detail.disruptions.length === 0 ? (
                <View style={styles.emptyBlock}>
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={SEVERITY_COLOR.good}
                  />
                  <Text style={styles.emptyText}>
                    No active disruptions reported.
                  </Text>
                </View>
              ) : (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>What's going on</Text>
                  {detail.disruptions.map((d, i) => (
                    <View key={`d-${i}`} style={styles.disruption}>
                      {d.category ? (
                        <Text style={styles.category}>{d.category}</Text>
                      ) : null}
                      <Text style={styles.disruptionText}>{d.description}</Text>
                      {d.affectedRoutes && d.affectedRoutes.length > 0 ? (
                        <Text style={styles.affectedRoutes}>
                          Affects: {d.affectedRoutes.join(' · ')}
                        </Text>
                      ) : null}
                      {d.closureText ? (
                        <Text style={styles.closureText}>{d.closureText}</Text>
                      ) : null}
                      {d.link ? (
                        <Pressable
                          onPress={() => {
                            track('line_operator_notice_opened', { line_id: lineId });
                            Linking.openURL(d.link!).catch(() => undefined);
                          }}
                          style={styles.linkBtn}
                          accessibilityRole="link"
                        >
                          <Ionicons
                            name="open-outline"
                            size={15}
                            color={colors.primary}
                          />
                          <Text style={styles.linkText} numberOfLines={1}>
                            Open operator notice
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}

              {/* Affected stations */}
              {detail.affectedStops.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    Affected stations · {detail.affectedStops.length}
                  </Text>
                  {detail.affectedStops.map((s) => (
                    <View key={s.id} style={styles.stopRow}>
                      <Ionicons
                        name="location"
                        size={16}
                        color={colors.textSecondary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.stopName}>{s.name}</Text>
                        {s.meta ? (
                          <Text style={styles.stopMeta}>{s.meta}</Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textOnPrimary,
    letterSpacing: 0.3,
  },
  timestamp: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  body: { marginTop: 14 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  loadingText: { color: colors.textSecondary },
  error: { color: colors.accent, padding: 16 },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  disruption: {
    backgroundColor: colors.surfaceMuted,
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
  },
  category: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primaryDark,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  disruptionText: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  affectedRoutes: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
    fontStyle: 'italic',
  },
  closureText: {
    fontSize: 12,
    color: colors.textPrimary,
    marginTop: 8,
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  linkText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
    maxWidth: 220,
  },
  emptyBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stopName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  stopMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
