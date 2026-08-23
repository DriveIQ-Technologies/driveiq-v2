import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { colors } from '@/theme/colors';
import {
  incidentColor,
  incidentIconName,
  type TrafficIncident,
} from '@/services/tflTraffic';

interface Props {
  incident: TrafficIncident | null;
  onClose: () => void;
  onNavigate?: (incident: TrafficIncident) => void;
}

const fmt = (iso?: string): string | null => {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export function TrafficIncidentSheet({ incident, onClose, onNavigate }: Props) {
  if (!incident) return null;
  const color = incidentColor(incident.severity);
  const icon = incidentIconName(incident.category, incident.hasClosures);
  const start = fmt(incident.startsAt);
  const end = fmt(incident.endsAt);

  return (
    <SheetOverlay onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={[styles.iconBubble, { backgroundColor: color }]}>
            <Ionicons name={icon} size={22} color={colors.textOnPrimary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.severity}>{incident.severity}</Text>
            <Text style={styles.category}>
              {incident.category}
              {incident.subCategory ? ` · ${incident.subCategory}` : ''}
              {incident.hasClosures ? ' · Closure' : ''}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
          {incident.location ? (
            <Text style={styles.location}>{incident.location}</Text>
          ) : null}
          {incident.comments ? (
            <Text style={styles.comments}>{incident.comments}</Text>
          ) : null}
          {(start || end) && (
            <View style={styles.timeBlock}>
              {start ? (
                <Text style={styles.timeLine}>
                  <Text style={styles.timeLabel}>Started: </Text>
                  {start}
                </Text>
              ) : null}
              {end ? (
                <Text style={styles.timeLine}>
                  <Text style={styles.timeLabel}>Expected end: </Text>
                  {end}
                </Text>
              ) : null}
            </View>
          )}

          {onNavigate ? (
            <Pressable
              onPress={() => onNavigate(incident)}
              style={styles.directionsBtn}
              accessibilityRole="button"
              accessibilityLabel="Get directions to this incident"
            >
              <Ionicons name="navigate" size={18} color={colors.textOnPrimary} />
              <Text style={styles.directionsText}>Route around incident</Text>
            </Pressable>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  severity: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  category: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  body: { marginTop: 14 },
  location: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: 8 },
  comments: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  timeBlock: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  timeLine: { fontSize: 13, color: colors.textPrimary, marginBottom: 4 },
  timeLabel: { fontWeight: '700', color: colors.textSecondary },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  directionsText: { color: colors.textOnPrimary, fontSize: 15, fontWeight: '700' },
});
