import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import type { AppEvent } from '@/types/event';

import {
  categoryMeta,
  crowdLabel,
  eventLifeStatus,
  formatTimeRange,
  sourceLabel,
} from './eventPresentation';

interface Props {
  event: AppEvent;
  featured?: boolean;
  onRemind?: () => boolean | Promise<boolean>;
  onCalendar?: () => boolean | Promise<boolean>;
  onPress?: () => void;
}

export function EventCard({ event, featured, onRemind, onCalendar, onPress }: Props) {
  const cat = categoryMeta(event);
  const status = eventLifeStatus(event);
  const crowd = crowdLabel(event);
  const [remindDone, setRemindDone] = useState(false);
  const [calDone, setCalDone] = useState(false);
  const [busy, setBusy] = useState<'remind' | 'cal' | null>(null);

  const runAction = async (kind: 'remind' | 'cal', fn: () => boolean | Promise<boolean>) => {
    if (busy) return;
    if (kind === 'remind' && remindDone) return;
    if (kind === 'cal' && calDone) return;
    setBusy(kind);
    try {
      const ok = await fn();
      if (ok) {
        if (kind === 'remind') setRemindDone(true);
        else setCalDone(true);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, featured && styles.featured]}
      accessibilityRole="button"
      accessibilityLabel={event.title}
    >
      <CategoryChipInline label={cat.label} color={cat.color} live={status === 'live'} />
      <Text style={styles.title} numberOfLines={2}>
        {event.title}
      </Text>
      <Text style={styles.meta}>{formatTimeRange(event)}</Text>
      <Text style={styles.venue} numberOfLines={1}>
        {event.venue}
      </Text>
      {crowd ? <Text style={styles.crowd}>{crowd}</Text> : null}
      {event.copyLine ? (
        <Text style={styles.copy} numberOfLines={2}>
          {event.copyLine}
        </Text>
      ) : null}
      <Text style={styles.source}>
        Source · {sourceLabel(event)}
        {crowd?.includes('estimated') ? ' · Estimated attendance' : ''}
      </Text>
      <View style={styles.actions}>
        {onCalendar ? (
          <Pressable
            style={[styles.actionBtn, calDone && styles.actionBtnDone]}
            onPress={(e) => {
              e.stopPropagation();
              void runAction('cal', onCalendar);
            }}
            hitSlop={6}
            accessibilityState={{ disabled: calDone || busy === 'cal' }}
          >
            <Ionicons
              name={calDone ? 'checkmark-circle' : 'calendar-outline'}
              size={14}
              color={calDone ? colors.success : colors.textPrimary}
            />
            <Text style={[styles.actionText, calDone && styles.actionTextDone]}>
              {calDone ? 'Added' : busy === 'cal' ? 'Adding…' : 'Calendar'}
            </Text>
          </Pressable>
        ) : null}
        {onRemind ? (
          <Pressable
            style={[styles.actionBtn, remindDone && styles.actionBtnDone]}
            onPress={(e) => {
              e.stopPropagation();
              void runAction('remind', onRemind);
            }}
            hitSlop={6}
            accessibilityState={{ disabled: remindDone || busy === 'remind' }}
          >
            <Ionicons
              name={remindDone ? 'checkmark-circle' : 'notifications-outline'}
              size={14}
              color={remindDone ? colors.success : colors.textPrimary}
            />
            <Text style={[styles.actionText, remindDone && styles.actionTextDone]}>
              {remindDone ? 'Saved' : busy === 'remind' ? 'Saving…' : 'Remind'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function CategoryChipInline({
  label,
  color,
  live,
}: {
  label: string;
  color: string;
  live?: boolean;
}) {
  return (
    <View style={styles.chipRow}>
      <View style={[styles.chip, { backgroundColor: `${color}18` }]}>
        <Text style={[styles.chipText, { color }]}>{label.toUpperCase()}</Text>
      </View>
      {live ? <Text style={styles.live}>LIVE</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    gap: 6,
  },
  featured: {
    borderColor: `${colors.featured}55`,
    backgroundColor: '#FFFBF3',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  live: {
    fontSize: 10,
    fontWeight: '700',
    color: '#E53935',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 22,
  },
  meta: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  venue: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  crowd: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  copy: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  source: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtnDone: {
    opacity: 0.75,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  actionTextDone: {
    color: colors.success,
  },
});
