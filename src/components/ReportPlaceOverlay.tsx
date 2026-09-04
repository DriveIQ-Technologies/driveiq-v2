import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Drop a pin at the map centre. The user pans the map under a fixed pin
 * instead of hunting for a tiny draggable marker.
 */
export function ReportPlaceOverlay({ visible, onCancel, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={[styles.banner, { top: Math.max(insets.top, 12) + 8 }]} pointerEvents="none">
        <Ionicons name="move" size={16} color={colors.textOnPrimary} />
        <Text style={styles.bannerText}>Drag the map to move the pin</Text>
      </View>

      <View style={styles.pinWrap} pointerEvents="none">
        <View style={styles.bubble}>
          <Ionicons name="location" size={22} color={colors.textOnPrimary} />
        </View>
        <View style={styles.tail} />
        <View style={styles.dot} />
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable style={styles.confirm} onPress={onConfirm} accessibilityRole="button">
          <Ionicons name="checkmark" size={18} color={colors.textOnPrimary} />
          <Text style={styles.confirmText}>This is the spot</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  bannerText: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  pinWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -18,
    marginTop: -44,
    alignItems: 'center',
  },
  bubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  tail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.primary,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 2,
    opacity: 0.45,
  },
  footer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
  },
  cancel: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  confirm: {
    flex: 2,
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
});
