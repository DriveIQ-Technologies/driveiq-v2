import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { colors } from '@/theme/colors';
import { track, trackScreen } from '@/services/analytics';
import type { AppEvent } from '@/types/event';
import { formatEventDate, formatEventEndTime, formatLondonHhmm } from '@/utils/dateFilters';
import { cleanDescription } from '@/utils/description';
import { distanceKm, formatDistance, type LatLng } from '@/utils/distance';
import { pinDescriptorFor } from '@/utils/eventIcons';

interface EventDetailsSheetProps {
  event: AppEvent | null;
  userLocation: LatLng | null;
  onClose: () => void;
  onNavigate?: (event: AppEvent) => void;
  /** Whether the currently-shown event is saved. */
  saved?: boolean;
  /** Toggle saved state (also schedules / cancels the 1-hour reminder). */
  onToggleSave?: (event: AppEvent) => void;
  /** Add the event to the device calendar (start + end). */
  onAddToCalendar?: (event: AppEvent) => void;
}

export function EventDetailsSheet({
  event,
  userLocation,
  onClose,
  onNavigate,
  saved = false,
  onToggleSave,
  onAddToCalendar,
}: EventDetailsSheetProps) {
  const visible = event != null;

  React.useEffect(() => {
    if (!event) return;
    trackScreen('event_details_sheet', {
      event_id: event.id,
      category: event.category,
    });
  }, [event]);

  if (!visible) return null;

  return (
    <SheetOverlay onRequestClose={onClose}>
      <View style={styles.backdrop} pointerEvents="box-none">
        <View style={styles.sheet}>
          {event && <SheetBody event={event} userLocation={userLocation} />}
          <View style={styles.actions}>
            {event && onNavigate ? (
              <Pressable
                onPress={() => {
                  track('event_details_directions_tapped', { event_id: event.id });
                  onNavigate(event);
                }}
                style={styles.directionsBtn}
                accessibilityRole="button"
                accessibilityLabel="Get directions to this event"
              >
                <Ionicons name="navigate" size={18} color={colors.textOnPrimary} />
                <Text style={styles.directionsText}>Get directions</Text>
              </Pressable>
            ) : null}

            {event && (onToggleSave || onAddToCalendar) ? (
              <View style={styles.secondaryRow}>
                {onToggleSave ? (
                  <Pressable
                    onPress={() => {
                      track('event_details_save_tapped', {
                        event_id: event.id,
                        next_state: saved ? 'unsave' : 'save',
                      });
                      onToggleSave(event);
                    }}
                    style={[styles.secondaryBtn, saved && styles.secondaryBtnActive]}
                    accessibilityRole="button"
                    accessibilityLabel={saved ? 'Remove saved event' : 'Save event'}
                  >
                    <Ionicons
                      name={saved ? 'bookmark' : 'bookmark-outline'}
                      size={17}
                      color={saved ? colors.textOnPrimary : colors.primary}
                    />
                    <Text
                      style={[
                        styles.secondaryText,
                        saved && styles.secondaryTextActive,
                      ]}
                    >
                      {saved ? 'Saved' : 'Save'}
                    </Text>
                  </Pressable>
                ) : null}
                {onAddToCalendar ? (
                  <Pressable
                    onPress={() => {
                      track('event_details_calendar_tapped', { event_id: event.id });
                      onAddToCalendar(event);
                    }}
                    style={styles.secondaryBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Add event to calendar"
                  >
                    <Ionicons name="calendar-outline" size={17} color={colors.primary} />
                    <Text style={styles.secondaryText}>Calendar</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close event details"
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SheetOverlay>
  );
}

function SheetBody({
  event,
  userLocation,
}: {
  event: AppEvent;
  userLocation: LatLng | null;
}) {
  const km = userLocation
    ? distanceKm(userLocation, {
        latitude: event.latitude,
        longitude: event.longitude,
      })
    : null;

  const descriptor = pinDescriptorFor(event);
  const accent = descriptor.color;
  // Show the sport glyph when it's a sport event; otherwise a DriveIQ-style
  // brand glyph (small "DQ") so the chip stays on-brand for non-sports.
  const tagIcon = descriptor.kind === 'glyph' ? descriptor.icon : 'DQ';
  const categoryLabel =
    event.subCategory ?? (event.category === 'sports' ? 'Sports' : 'Event');
  const about = event.copyLine?.trim() || cleanDescription(event.description);
  const startIso = event.realStartAt ?? event.startsAt;
  const doorsIso = event.doorsAt;
  const finishIso = event.estimatedFinishAt ?? event.endsAt;
  const showDoors =
    doorsIso &&
    Math.abs(Date.parse(doorsIso) - Date.parse(startIso)) >= 10 * 60 * 1000;
  const turnout =
    event.turnoutMin && event.turnoutMax
      ? `${event.turnoutMin.toLocaleString('en-GB')} to ${event.turnoutMax.toLocaleString('en-GB')}`
      : null;

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      <View style={styles.handle} />
      <View style={[styles.tagRow]}>
        <View style={[styles.tag, { backgroundColor: accent }]}>
          <Text style={styles.tagIcon}>{tagIcon}</Text>
          <Text style={styles.tagText}>{categoryLabel}</Text>
        </View>
        {km != null && (
          <Text style={styles.distance}>{formatDistance(km)} away</Text>
        )}
      </View>

      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.date}>{formatEventDate(startIso)}</Text>
      {showDoors && doorsIso ? (
        <Text style={styles.endTime}>Doors {formatLondonHhmm(doorsIso)}</Text>
      ) : null}
      <Text style={styles.endTime}>
        Crowds leaving around {formatEventEndTime(startIso, finishIso)}
      </Text>

      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>Venue</Text>
        <Text style={styles.metaValue}>{event.venue}</Text>
      </View>

      {turnout ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Turnout</Text>
          <Text style={styles.metaValue}>{turnout}</Text>
        </View>
      ) : null}

      {about ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>About</Text>
          <Text style={styles.metaValue}>{about}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 24,
    maxHeight: '70%',
  },
  body: {
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 16,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  tagIcon: {
    fontSize: 13,
  },
  tagText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  distance: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  date: {
    fontSize: 15,
    color: colors.primaryDark,
    fontWeight: '600',
    marginBottom: 4,
  },
  endTime: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
    marginBottom: 16,
  },
  metaRow: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  metaLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 21,
  },
  actions: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 10,
  },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  directionsText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  secondaryBtnActive: {
    backgroundColor: colors.primary,
  },
  secondaryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryTextActive: {
    color: colors.textOnPrimary,
  },
  closeBtn: {
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
  },
  closeText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
});
