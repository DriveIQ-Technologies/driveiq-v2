import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '@/theme/colors';
import { track, trackScreen } from '@/services/analytics';

export interface NavDestination {
  label: string;
  latitude: number;
  longitude: number;
}

interface Props {
  destination: NavDestination | null;
  onClose: () => void;
  /** Picked DriveIQ → trigger the in-app routing flow. */
  onPickDriveIQ: (dest: NavDestination) => void;
}

interface AppOption {
  id: 'driveiq' | 'google' | 'waze' | 'apple';
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  badgeColor: string;
}

const OPTIONS_BASE: AppOption[] = [
  { id: 'driveiq', label: 'DriveIQ', icon: 'navigate', badgeColor: colors.primary },
  { id: 'google',  label: 'Google Maps', icon: 'map', badgeColor: '#34A853' },
  { id: 'waze',    label: 'Waze', icon: 'car-sport', badgeColor: '#33CCFF' },
  { id: 'apple',   label: 'Apple Maps', icon: 'compass', badgeColor: '#1F62C9' },
];

// Apple Maps doesn't open on Android — hide it there.
const OPTIONS: AppOption[] =
  Platform.OS === 'android'
    ? OPTIONS_BASE.filter((o) => o.id !== 'apple')
    : OPTIONS_BASE;

/**
 * Try a native deep-link URL first; fall back to the universal HTTPS URL
 * if the native app isn't installed. Always closes the modal afterwards.
 */
async function openExternal(
  nativeUrl: string,
  fallbackUrl: string,
  appName: string,
): Promise<void> {
  try {
    const canOpen = await Linking.canOpenURL(nativeUrl);
    if (canOpen) {
      await Linking.openURL(nativeUrl);
      return;
    }
  } catch (e) {
    console.warn(`[nav-picker] canOpenURL failed for ${appName}`, e);
  }
  try {
    await Linking.openURL(fallbackUrl);
  } catch (e) {
    console.warn(`[nav-picker] openURL fallback failed for ${appName}`, e);
    Alert.alert(
      `Couldn't open ${appName}`,
      `Make sure ${appName} is installed, or pick a different app.`,
    );
  }
}

const launchExternalApp = (
  app: AppOption['id'],
  dest: NavDestination,
): Promise<void> => {
  const lat = dest.latitude;
  const lng = dest.longitude;
  const label = encodeURIComponent(dest.label || 'Destination');

  switch (app) {
    case 'google': {
      const native = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
      const universal = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
      return openExternal(native, universal, 'Google Maps');
    }
    case 'waze': {
      const native = `waze://?ll=${lat},${lng}&navigate=yes`;
      const universal = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
      return openExternal(native, universal, 'Waze');
    }
    case 'apple': {
      // Apple Maps accepts both; the http://maps.apple.com form is the
      // documented universal scheme that opens the native app on iOS.
      const native = `maps://?daddr=${lat},${lng}&q=${label}&dirflg=d`;
      const universal = `http://maps.apple.com/?daddr=${lat},${lng}&q=${label}&dirflg=d`;
      return openExternal(native, universal, 'Apple Maps');
    }
    default:
      return Promise.resolve();
  }
};

export function NavigationAppPicker({ destination, onClose, onPickDriveIQ }: Props) {
  const visible = destination != null;

  React.useEffect(() => {
    if (!destination) return;
    trackScreen('navigation_app_picker');
  }, [destination]);

  const handlePick = async (id: AppOption['id']) => {
    if (!destination) return;
    track('navigation_app_selected', { app: id });
    if (id === 'driveiq') {
      onPickDriveIQ(destination);
      onClose();
      return;
    }
    await launchExternalApp(id, destination);
    onClose();
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>Open with</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {destination?.label ?? 'Destination'}
          </Text>

          <View style={styles.grid}>
            {OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                style={styles.cell}
                onPress={() => handlePick(opt.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open with ${opt.label}`}
              >
                <View style={[styles.iconBubble, { backgroundColor: opt.badgeColor }]}>
                  <Ionicons name={opt.icon} size={26} color={colors.textOnPrimary} />
                </View>
                <Text style={styles.cellLabel}>{opt.label}</Text>
                {opt.id === 'driveiq' ? (
                  <Text style={styles.cellTag}>In-app</Text>
                ) : null}
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={onClose}
            style={styles.cancelBtn}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 42, 58, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 22,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  cell: {
    width: '47%',
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
  },
  iconBubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cellLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cellTag: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  cancelBtn: {
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
  },
  cancelText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
});
