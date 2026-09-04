import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import type { AppEvent } from '@/types/event';

import { EventCard } from './EventCard';
import type { EventDaySection } from './eventPresentation';

interface Props {
  section: EventDaySection;
  onRemind?: (event: AppEvent) => boolean | Promise<boolean>;
  onCalendar?: (event: AppEvent) => boolean | Promise<boolean>;
}

export function EventSectionBlock({ section, onRemind, onCalendar }: Props) {
  const { featured, events } = section;
  const rest = featured ? events.filter((e) => e.id !== featured.id) : events;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>{section.label}</Text>
        <Text style={styles.sub}>
          {section.sublabel} · {section.events.length} event
          {section.events.length === 1 ? '' : 's'}
        </Text>
      </View>
      {featured ? (
        <View style={styles.featuredWrap}>
          <Text style={styles.featuredTag}>FEATURED</Text>
          <EventCard
            event={featured}
            featured
            onRemind={onRemind ? () => onRemind(featured) : undefined}
            onCalendar={onCalendar ? () => onCalendar(featured) : undefined}
          />
        </View>
      ) : null}
      {rest.map((e) => (
        <EventCard
          key={e.id}
          event={e}
          onRemind={onRemind ? () => onRemind(e) : undefined}
          onCalendar={onCalendar ? () => onCalendar(e) : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
    marginTop: 4,
  },
  header: {
    gap: 2,
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.textSecondary,
  },
  sub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  featuredWrap: {
    gap: 8,
  },
  featuredTag: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.featured,
  },
});
