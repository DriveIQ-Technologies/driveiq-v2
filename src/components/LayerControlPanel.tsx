import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { colors } from '@/theme/colors';

export type LayerKey = 'events' | 'traffic' | 'transit';

export type LayerVisibility = Record<LayerKey, boolean>;

interface Props {
  visible: boolean;
  onClose: () => void;
  layers: LayerVisibility;
  onToggle: (key: LayerKey) => void;
}

interface LayerDef {
  key: LayerKey;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}

const LAYERS: LayerDef[] = [
  {
    key: 'events',
    label: 'Events',
    description: 'Sports, music, theatre and more',
    icon: 'calendar',
    color: colors.primary,
  },
  {
    key: 'traffic',
    label: 'Traffic',
    description: 'Live road flow + incidents (TfL & Highways)',
    icon: 'warning',
    color: '#F97316',
  },
  {
    key: 'transit',
    label: 'Transit hubs',
    description: 'Tube and rail station markers',
    icon: 'train',
    color: '#26C281',
  },
];

export function LayerControlPanel({ visible, onClose, layers, onToggle }: Props) {
  if (!visible) return null;

  const allOn = LAYERS.every((l) => layers[l.key]);
  const allOff = LAYERS.every((l) => !layers[l.key]);

  const setAll = (on: boolean) => {
    for (const l of LAYERS) {
      if (layers[l.key] !== on) onToggle(l.key);
    }
  };

  return (
    <SheetOverlay onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Ionicons name="layers" size={22} color={colors.textOnPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Map layers</Text>
            <Text style={styles.subtitle}>Choose what shows on the map</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.quickRow}>
          <Pressable
            onPress={() => setAll(true)}
            disabled={allOn}
            style={[styles.quickBtn, allOn && styles.quickBtnDisabled]}
          >
            <Text style={[styles.quickText, allOn && styles.quickTextDisabled]}>Show all</Text>
          </Pressable>
          <Pressable
            onPress={() => setAll(false)}
            disabled={allOff}
            style={[styles.quickBtn, allOff && styles.quickBtnDisabled]}
          >
            <Text style={[styles.quickText, allOff && styles.quickTextDisabled]}>Hide all</Text>
          </Pressable>
        </View>

        <View style={styles.list}>
          {LAYERS.map((l) => (
            <View key={l.key} style={styles.row}>
              <View style={[styles.iconBubble, { backgroundColor: l.color }]}>
                <Ionicons name={l.icon} size={18} color={colors.textOnPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{l.label}</Text>
                <Text style={styles.description}>{l.description}</Text>
              </View>
              <Switch
                value={layers[l.key]}
                onValueChange={() => onToggle(l.key)}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={colors.surface}
              />
            </View>
          ))}
        </View>
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
    paddingBottom: 28,
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
  quickRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  quickBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
  },
  quickBtnDisabled: { backgroundColor: colors.surfaceMuted },
  quickText: { color: colors.primary, fontWeight: '700' },
  quickTextDisabled: { color: colors.textSecondary },
  list: { marginTop: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  description: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
