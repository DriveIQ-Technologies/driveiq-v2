import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_LOGO = require('../../assets/driveiq-logo@hd.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GLOW = require('../../assets/splash-glow.png');

const RING = 'rgba(85, 140, 220, 0.38)';

interface Props {
  size?: number;
}

/**
 * Compact splash-style mark: logo sits still while the blue halo
 * pulses and a faint ring expands / contracts.
 */
export function BrandPulseMark({ size = 72 }: Props) {
  const glow = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, {
          toValue: 1,
          duration: 2200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    glowLoop.start();
    ringLoop.start();
    return () => {
      glowLoop.stop();
      ringLoop.stop();
    };
  }, [glow, ring]);

  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.18] });
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.55] });
  const ringOpacity = ring.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 0.55, 0],
  });

  const box = size * 2.1;
  const logo = size * 0.58;
  const wrap = size * 0.92;

  return (
    <View style={[styles.area, { width: box, height: box }]}>
      <Animated.Image
        source={GLOW}
        style={[
          styles.glow,
          {
            width: box,
            height: box,
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.pulseRing,
          {
            width: wrap,
            height: wrap,
            borderRadius: wrap / 2,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      <View
        style={[
          styles.wrap,
          {
            width: wrap,
            height: wrap,
            borderRadius: wrap * 0.32,
          },
        ]}
      >
        <Image source={BRAND_LOGO} style={{ width: logo, height: logo }} resizeMode="contain" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  glow: {
    position: 'absolute',
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: RING,
  },
  wrap: {
    backgroundColor: '#0C1422',
    borderWidth: 1,
    borderColor: 'rgba(76, 169, 255, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
