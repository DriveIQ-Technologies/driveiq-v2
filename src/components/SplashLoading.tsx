import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

// High-res DriveIQ brand mark (crisp edges, transparent background).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_LOGO = require('../../assets/driveiq-logo@hd.png');
// Pre-rendered smooth radial glow (avoids banding / rectangular shadows).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GLOW = require('../../assets/splash-glow.png');

const BG = '#060B14'; // near-black navy from the Radar Pulse concept
const RING = 'rgba(85, 140, 220, 0.32)'; // faint radar-ring blue
const WORD_LETTERS = ['D', 'r', 'i', 'v', 'e', 'I', 'Q'];
const WHITE_CHARS = 5; // "Drive" white, "IQ" brand blue
const TAGLINE = 'KNOW YOUR CITY BEFORE IT MOVES';
const TYPE_START = 400; // ms before first letter appears
const TYPE_STEP = 90; // ms between letters

/** Brand beat — long enough for the wordmark, short enough not to feel stuck. */
const MIN_MS = 1400;
/** Hard cap so a slow auth never leaves the user staring at splash. */
const MAX_MS = 3200;

interface Props {
  /**
   * When true, splash may dismiss (after the min brand beat). Use this to
   * cover auth warm-up so the session is ready when the map appears.
   */
  ready?: boolean;
  /** Called once the fade-out completes so the parent can unmount it. */
  onDone: () => void;
}

/** One expanding + fading radar ring, staggered by `delay`. */
function RadarRing({ delay }: { delay: number }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(t, {
          toValue: 1,
          duration: 2600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.55, 2.4] });
  const opacity = t.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 0.6, 0],
  });

  return (
    <Animated.View style={[styles.radarRing, { opacity, transform: [{ scale }] }]} />
  );
}

/**
 * DriveIQ launch screen — "Radar Pulse" concept.
 *
 * Covers the map while auth settles. Touches pass through so the menu button
 * (rendered above this layer) stays clickable from first paint. Dismisses as
 * soon as `ready` is true after a short brand beat, or at MAX_MS whichever
 * comes first.
 */
export function SplashLoading({ ready = true, onDone }: Props) {
  const logo = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const tag = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const letters = useRef(WORD_LETTERS.map(() => new Animated.Value(0))).current;
  const dots = [
    useRef(new Animated.Value(0.25)).current,
    useRef(new Animated.Value(0.25)).current,
    useRef(new Animated.Value(0.25)).current,
  ];
  const startedAt = useRef(Date.now());
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(fade, {
      toValue: 0,
      duration: 280,
      useNativeDriver: true,
    }).start(() => onDone());
  };

  useEffect(() => {
    Animated.timing(logo, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();

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
    glowLoop.start();

    const typing = Animated.stagger(
      TYPE_STEP,
      letters.map((l) =>
        Animated.timing(l, { toValue: 1, duration: 40, useNativeDriver: true }),
      ),
    );
    const wordSeq = Animated.sequence([
      Animated.delay(TYPE_START),
      typing,
      Animated.timing(tag, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]);
    wordSeq.start();

    const dotLoops = dots.map((d, idx) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(idx * 180),
          Animated.timing(d, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.25, duration: 350, useNativeDriver: true }),
          Animated.delay((2 - idx) * 180),
        ]),
      ),
    );
    dotLoops.forEach((l) => l.start());

    // Never leave the user stuck if auth is slow.
    const maxTimer = setTimeout(finish, MAX_MS);

    return () => {
      clearTimeout(maxTimer);
      glowLoop.stop();
      wordSeq.stop();
      dotLoops.forEach((l) => l.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismiss once auth (or other gate) is ready and the brand beat has played.
  useEffect(() => {
    if (!ready) return;
    const elapsed = Date.now() - startedAt.current;
    const wait = Math.max(0, MIN_MS - elapsed);
    const id = setTimeout(finish, wait);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const logoScale = logo.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} pointerEvents="none">
      <View style={styles.center}>
        <View style={styles.logoArea}>
          <Animated.Image
            source={GLOW}
            style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
          />
          <View style={styles.staticRing} />
          <RadarRing delay={0} />
          <RadarRing delay={870} />
          <RadarRing delay={1740} />
          <Animated.View style={{ opacity: logo, transform: [{ scale: logoScale }] }}>
            <Image source={BRAND_LOGO} resizeMode="contain" style={styles.logo} />
          </Animated.View>
        </View>

        <View style={styles.wordRow}>
          {WORD_LETTERS.map((ch, i) => (
            <Animated.Text
              key={i}
              style={[
                styles.wordLetter,
                i < WHITE_CHARS ? styles.wordWhite : styles.wordBlue,
                { opacity: letters[i] },
              ]}
            >
              {ch}
            </Animated.Text>
          ))}
        </View>

        <Animated.Text style={[styles.tagline, { opacity: tag }]}>{TAGLINE}</Animated.Text>

        <View style={styles.dotsRow}>
          {dots.map((d, i) => (
            <Animated.View key={i} style={[styles.dot, { opacity: d }]} />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    // Below chrome (menu) and sidebar so those stay tappable during splash.
    zIndex: 50,
    elevation: 50,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  logoArea: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 340,
    height: 340,
  },
  staticRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: RING,
  },
  radarRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: RING,
  },
  logo: {
    width: 96,
    height: 118,
  },
  wordRow: {
    flexDirection: 'row',
    marginTop: 24,
    minHeight: 42,
  },
  wordLetter: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  wordWhite: { color: '#F4F7FB' },
  wordBlue: { color: colors.primary },
  tagline: {
    color: 'rgba(150, 175, 210, 0.75)',
    fontSize: 11,
    letterSpacing: 3.2,
    marginTop: 10,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 34,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.primary,
  },
});
