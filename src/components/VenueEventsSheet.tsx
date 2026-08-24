import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PremiumInlineBar } from '@/components/PremiumInlineBar';
import { showPremiumPaywall } from '@/services/subscription';
import { colors } from '@/theme/colors';
import type { AppEvent } from '@/types/event';
import { formatEventDate } from '@/utils/dateFilters';
import { CATEGORY_FILTERS, categoryFilterFor, pinDescriptorFor } from '@/utils/eventIcons';

interface Props {
  /** Events sharing one location, soonest first. Null/empty → hidden. */
  events: AppEvent[] | null;
  /** Premium-locked events at this venue (dimmed rows). */
  lockedEvents?: AppEvent[];
  onClose: () => void;
  /** User picked one event from the list → open its details. */
  onPickEvent: (event: AppEvent) => void;
}

/**
 * When several events share the same venue, the map shows a single pin at
 * that location (per Donnie, 5 July 2026 — no count bubbles, pins point at
 * the real spot). Tapping that pin opens this sheet: every event at the
 * venue, soonest first. Picking a row opens the normal event details sheet.
 */
export function VenueEventsSheet({ events, lockedEvents = [], onClose, onPickEvent }: Props) {
  if (!events || events.length === 0) {
    if (lockedEvents.length === 0) return null;
  }
  const venue = events?.[0]?.venue || lockedEvents[0]?.venue || 'This location';
  const openCount = events?.length ?? 0;
  const lockedCount = lockedEvents.length;

  return (
    <SheetOverlay onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.iconBubble}>
            <Ionicons name="location" size={22} color={colors.textOnPrimary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.venue} numberOfLines={1}>
              {venue}
            </Text>
            <Text style={styles.subtitle}>
              {openCount + lockedCount} events at this location
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
          {(events ?? []).map((event) => {
            const desc = pinDescriptorFor(event);
            const cat = CATEGORY_FILTERS.find((c) => c.key === categoryFilterFor(event));
            return (
              <Pressable
                key={event.id}
                style={styles.row}
                onPress={() => onPickEvent(event)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${event.title}`}
              >
                <View style={[styles.rowIcon, { borderColor: desc.color }]}>
                  <Text style={styles.rowGlyph}>
                    {desc.kind === 'glyph' ? desc.icon : cat?.icon ?? '✨'}
                  </Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {event.title}
                  </Text>
                  <Text style={styles.rowMeta}>{formatEventDate(event.startsAt)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            );
          })}
          {lockedCount > 0 ? (
            <>
              <PremiumInlineBar
                feature="Browse events beyond tomorrow"
                source="venue_events"
                message={`${lockedCount} later event${lockedCount === 1 ? '' : 's'} at this venue need DriveIQ Premium.`}
              />
              {lockedEvents.map((event) => (
                <View key={`locked-${event.id}`} style={[styles.row, styles.rowLocked]}>
                  <View style={[styles.rowIcon, styles.rowIconLocked]}>
                    <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitleLocked} numberOfLines={2}>
                      {event.title}
                    </Text>
                    <Text style={styles.rowMeta}>{formatEventDate(event.startsAt)}</Text>
                  </View>
                  <Pressable
                    onPress={() =>
                      showPremiumPaywall('Browse events beyond tomorrow', {
                        source: 'venue_events',
                        inline: true,
                      })
                    }
                    hitSlop={8}
                  >
                    <Text style={styles.premiumTag}>Premium</Text>
                  </Pressable>
                </View>
              ))}
            </>
          ) : null}
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
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '70%',
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
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  venue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  body: { marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2.5,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowGlyph: { fontSize: 17, textAlign: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: colors.textPrimary },
  rowMeta: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  rowLocked: { opacity: 0.55 },
  rowIconLocked: { borderColor: colors.border },
  rowTitleLocked: { fontSize: 14.5, fontWeight: '600', color: colors.textSecondary },
  premiumTag: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
});
