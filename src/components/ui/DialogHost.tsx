/**
 * Renders queued in-app dialogs at the very top of the app tree.
 *
 * Mounted once in the root layout so it always paints above every sheet — see
 * `src/services/dialog.ts` for why we no longer use `Alert.alert` inside sheets.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  dismissDialog,
  subscribeDialogs,
  type DialogButton,
  type DialogRequest,
} from '@/services/dialog';
import { colors } from '@/theme/colors';

export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => subscribeDialogs(setQueue), []);

  // Newest request wins so a permission prompt can't be buried behind an
  // older one; the rest stay queued and appear as it is dismissed.
  const current = queue[queue.length - 1];
  if (!current) return null;
  return <Dialog key={current.id} request={current} />;
}

function Dialog({ request }: { request: DialogRequest }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [anim]);

  const close = (button?: DialogButton) => {
    dismissDialog(request.id);
    button?.onPress?.();
  };

  const cancelButton =
    request.buttons.find((b) => b.style === 'cancel') ??
    (request.buttons.length === 1 ? request.buttons[0] : undefined);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissDialog(request.id);
      cancelButton?.onPress?.();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  // Two short buttons sit side by side; anything longer stacks so labels
  // never truncate.
  const stacked =
    request.buttons.length > 2 ||
    request.buttons.some((b) => b.label.length > 14);

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.dim, { opacity: anim }]} pointerEvents="none" />
      <Pressable
        style={StyleSheet.absoluteFillObject}
        onPress={() => close(cancelButton)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      />
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            {
              opacity: anim,
              transform: [
                {
                  scale: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.94, 1],
                  }),
                },
              ],
            },
          ]}
          accessibilityViewIsModal
        >
          <Text style={styles.title}>{request.title}</Text>
          {request.message ? (
            <Text style={styles.message}>{request.message}</Text>
          ) : null}
          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {request.buttons.map((b, i) => {
              const primary = b.style !== 'cancel';
              return (
                <Pressable
                  key={`${b.label}-${i}`}
                  onPress={() => close(b)}
                  style={({ pressed }) => [
                    styles.btn,
                    stacked && styles.btnStacked,
                    primary ? styles.btnPrimary : styles.btnGhost,
                    b.style === 'destructive' && styles.btnDestructive,
                    pressed && styles.btnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={b.label}
                >
                  <Text
                    style={[
                      styles.btnText,
                      primary ? styles.btnTextPrimary : styles.btnTextGhost,
                    ]}
                    numberOfLines={1}
                  >
                    {b.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 900,
    elevation: 900,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,20,32,0.45)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 26,
    elevation: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  message: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
  },
  actionsStacked: {
    flexDirection: 'column-reverse',
    alignItems: 'stretch',
  },
  btn: {
    minWidth: 92,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnStacked: {
    width: '100%',
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnGhost: {
    backgroundColor: colors.surfaceMuted,
  },
  btnDestructive: {
    backgroundColor: '#E5484D',
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  btnTextPrimary: {
    color: colors.textOnPrimary,
  },
  btnTextGhost: {
    color: colors.textPrimary,
  },
});
