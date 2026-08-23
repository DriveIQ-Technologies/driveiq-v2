/**
 * Non-modal bottom-sheet container, painted through a root host.
 *
 * Every sheet used to be a native `<Modal>`. On iOS each Modal gets its own
 * UIWindow, so stacking them (Connections → station → notify permission) left
 * an orphaned window that swallowed every touch — the app looked frozen until
 * it was force-quit.
 *
 * Nested overlays in the map tree had the same failure mode on both platforms:
 * each sheet owned a full-screen Pressable, and a system permission dialog
 * (Save / Notify on a station) returning on top of that stack stopped RN from
 * delivering touches.
 *
 * SheetOverlay now registers with `SheetHost` (mounted next to DialogHost in
 * the root layout). Nested sheets in React still *feel* nested, but they paint
 * as siblings above the map. Dialogs always win, and returning from a native
 * prompt remounts the pointer layer so a stuck Pressable cannot freeze the app.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  BackHandler,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

/** Sheets paint above the map + chrome, below the global dialog host (900). */
const BASE_Z = 400;

type CloseFn = () => void;

interface OverlayEntry {
  id: number;
  level: number;
  dim: boolean;
  dismissOnBackdropPress: boolean;
  children: React.ReactNode;
  close: CloseFn;
}

const entries = new Map<number, OverlayEntry>();
const listeners = new Set<(list: OverlayEntry[]) => void>();
let nextId = 1;
let pointerEpoch = 0;
const pointerListeners = new Set<(epoch: number) => void>();

function snapshot(): OverlayEntry[] {
  return [...entries.values()].sort((a, b) => a.id - b.id || a.level - b.level);
}

function emit(): void {
  const list = snapshot();
  for (const l of listeners) l(list);
}

/** Call after a native prompt (permissions, OS settings) so stuck backdrops die. */
export function resetSheetPointers(): void {
  pointerEpoch += 1;
  const epoch = pointerEpoch;
  for (const l of pointerListeners) l(epoch);
}

function handleBack(): boolean {
  const list = snapshot();
  const top = list[list.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

interface SheetOverlayProps {
  onRequestClose: () => void;
  children: React.ReactNode;
  /** Raises this sheet above sibling sheets when both are open. */
  level?: number;
  /** Set false for sheets that should not dim what's behind them. */
  dim?: boolean;
  /** Set false to stop backdrop taps from closing (e.g. destructive flows). */
  dismissOnBackdropPress?: boolean;
  /**
   * When false, the overlay unregisters and paints nothing. Sheets that forget
   * to early-return on their own `visible` prop used to leave a stuck layer
   * that ate every tap including the close button.
   */
  visible?: boolean;
}

export function SheetOverlay({
  onRequestClose,
  children,
  level = 0,
  dim = true,
  dismissOnBackdropPress = true,
  visible = true,
}: SheetOverlayProps) {
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = nextId++;
  const id = idRef.current;
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;

  // Mount / unmount in the host. Do not depend on `children` here — that would
  // delete+recreate the entry on every parent render and flicker the sheet.
  useLayoutEffect(() => {
    if (!visible) {
      if (entries.has(id)) {
        entries.delete(id);
        emit();
      }
      return;
    }
    entries.set(id, {
      id,
      level,
      dim,
      dismissOnBackdropPress,
      children,
      close: () => closeRef.current(),
    });
    emit();
    return () => {
      if (entries.has(id)) {
        entries.delete(id);
        emit();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, visible, level, dim, dismissOnBackdropPress]);

  // Patch live content without tearing the overlay down.
  useLayoutEffect(() => {
    if (!visible) return;
    const existing = entries.get(id);
    if (!existing) return;
    existing.children = children;
    existing.level = level;
    existing.dim = dim;
    existing.dismissOnBackdropPress = dismissOnBackdropPress;
    existing.close = () => closeRef.current();
    emit();
  });

  return null;
}

/** Mount once in the root layout, after the navigator, before DialogHost. */
export function SheetHost() {
  const [list, setList] = useState<OverlayEntry[]>(() => snapshot());
  const [epoch, setEpoch] = useState(pointerEpoch);
  const backSub = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    const onList = (next: OverlayEntry[]) => setList(next);
    listeners.add(onList);
    onList(snapshot());
    return () => {
      listeners.delete(onList);
    };
  }, []);

  useEffect(() => {
    const onEpoch = (next: number) => setEpoch(next);
    pointerListeners.add(onEpoch);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') resetSheetPointers();
    });
    return () => {
      pointerListeners.delete(onEpoch);
      app.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (list.length === 0) {
      backSub.current?.remove();
      backSub.current = null;
      return;
    }
    if (!backSub.current) {
      backSub.current = BackHandler.addEventListener('hardwareBackPress', handleBack);
    }
    return () => {
      if (list.length === 0) {
        backSub.current?.remove();
        backSub.current = null;
      }
    };
  }, [list.length]);

  if (list.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFillObject, styles.host]}
      collapsable={false}
    >
      {list.map((entry, index) => (
        <SheetLayer
          key={entry.id}
          entry={entry}
          stackIndex={index}
          pointerEpoch={epoch}
        />
      ))}
    </View>
  );
}

function SheetLayer({
  entry,
  stackIndex,
  pointerEpoch: epoch,
}: {
  entry: OverlayEntry;
  stackIndex: number;
  pointerEpoch: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const z = BASE_Z + stackIndex * 10 + entry.level;

  useEffect(() => {
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [anim]);

  return (
    <View
      style={[StyleSheet.absoluteFillObject, { zIndex: z, elevation: z }]}
      pointerEvents="box-none"
      collapsable={false}
    >
      {entry.dim ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.dim, { opacity: anim }]}
        />
      ) : null}
      <Pressable
        key={`backdrop-${epoch}`}
        style={StyleSheet.absoluteFillObject}
        onPress={entry.dismissOnBackdropPress ? entry.close : undefined}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <Animated.View
        pointerEvents="box-none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            opacity: anim,
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [90, 0],
                }),
              },
            ],
          },
        ]}
      >
        {entry.children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    zIndex: BASE_Z,
    elevation: BASE_Z,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
});
