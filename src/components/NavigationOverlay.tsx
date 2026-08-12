import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';
import {
  formatDuration,
  formatEta,
  formatRouteDistance,
  maneuverIcon,
  type RouteStep,
} from '@/services/routing';

interface Props {
  /** Current step the user is on. */
  currentStep: RouteStep | null;
  /** The next step after current, used for "then …" preview line. */
  nextStep: RouteStep | null;
  /** Distance in metres from the user to the end of the current step. */
  distanceToTurnMeters: number;
  /** Total remaining distance on the route in metres. */
  remainingDistanceMeters: number;
  /** Total remaining seconds (traffic-aware) on the route. */
  remainingSeconds: number;
  /** True when the user has dragged the map and is no longer following. */
  cameraDetached: boolean;
  /** True if route was lost or off-route. */
  offRoute: boolean;
  onRecenter: () => void;
  onExit: () => void;
}

/**
 * Full-screen navigation HUD. Top banner shows the next maneuver + distance
 * to it (Google Maps style). Bottom card shows ETA / remaining distance /
 * remaining time, with an Exit button. A floating "Re-centre" button shows
 * when the user has dragged the map away from their location.
 */
export function NavigationOverlay({
  currentStep,
  nextStep,
  distanceToTurnMeters,
  remainingDistanceMeters,
  remainingSeconds,
  cameraDetached,
  offRoute,
  onRecenter,
  onExit,
}: Props) {
  const turnIcon = maneuverIcon(currentStep?.maneuver);
  const turnLabel = currentStep?.instruction ?? 'Continue along the route';
  const turnDist = formatRouteDistance(distanceToTurnMeters);

  return (
    <View style={StyleSheetAbsoluteFill} pointerEvents="box-none">
      {/* Top instruction banner */}
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <View style={styles.topCard} pointerEvents="auto">
          <View style={styles.maneuverBubble}>
            <Ionicons name={turnIcon} size={34} color={colors.textOnPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.distance}>{turnDist}</Text>
            <Text style={styles.instruction} numberOfLines={2}>
              {turnLabel}
            </Text>
            {nextStep ? (
              <Text style={styles.thenLine} numberOfLines={1}>
                Then {nextStep.instruction.toLowerCase()}
              </Text>
            ) : null}
          </View>
        </View>
        {offRoute ? (
          <View style={styles.offRoute}>
            <Ionicons name="warning" size={16} color={colors.textOnPrimary} />
            <Text style={styles.offRouteText}>You are off route. Recalculating…</Text>
          </View>
        ) : null}
      </SafeAreaView>

      {/* Re-centre pill (only when camera is detached) */}
      {cameraDetached ? (
        <Pressable
          style={styles.recenter}
          onPress={onRecenter}
          accessibilityRole="button"
          accessibilityLabel="Re-centre on your location"
        >
          <Ionicons name="locate" size={18} color={colors.textOnPrimary} />
          <Text style={styles.recenterText}>Re-centre</Text>
        </Pressable>
      ) : null}

      {/* Bottom navigation summary */}
      <SafeAreaView edges={['bottom']} style={styles.bottomWrap} pointerEvents="box-none">
        <View style={styles.bottomCard} pointerEvents="auto">
          <View style={styles.bottomMetrics}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {formatDuration(remainingSeconds)}
              </Text>
              <Text style={styles.metricLabel}>Remaining</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {formatRouteDistance(remainingDistanceMeters)}
              </Text>
              <Text style={styles.metricLabel}>Distance</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {formatEta(remainingSeconds)}
              </Text>
              <Text style={styles.metricLabel}>Arrival</Text>
            </View>
          </View>
          <Pressable
            onPress={onExit}
            style={styles.exitBtn}
            accessibilityRole="button"
            accessibilityLabel="Exit navigation"
          >
            <Ionicons name="close" size={20} color={colors.textOnPrimary} />
            <Text style={styles.exitText}>Exit</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

const styles = StyleSheet.create({
  topCard: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  maneuverBubble: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  distance: {
    color: colors.textOnPrimary,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  instruction: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  thenLine: {
    color: colors.textOnPrimary,
    opacity: 0.78,
    fontSize: 12,
    marginTop: 4,
  },
  offRoute: {
    marginTop: 8,
    marginHorizontal: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  offRouteText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  recenter: {
    position: 'absolute',
    right: 16,
    bottom: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primaryDark,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  recenterText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  bottomWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  bottomCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  bottomMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  metricLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },
  exitBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#DC2626',
  },
  exitText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
