/**
 * Foreground location for the map, distances, and the AI "near me" answers.
 * Never requests background / always-on tracking.
 */
import * as Location from 'expo-location';

import { getItem, setItem } from './storage';
import type { LatLng } from '@/utils/distance';

const KEY_SEEN = 'driveiq.locationOnboarding.seen.v1';

export async function hasSeenLocationOnboarding(): Promise<boolean> {
  return (await getItem(KEY_SEEN)) === '1';
}

export async function markLocationOnboardingSeen(): Promise<void> {
  await setItem(KEY_SEEN, '1');
}

export async function getForegroundLocationStatus(): Promise<Location.PermissionStatus> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status;
}

export async function readCurrentLocation(): Promise<LatLng | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
  } catch {
    return null;
  }
}

export async function requestForegroundLocation(): Promise<LatLng | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
  } catch {
    return null;
  }
}

/** Best-effort neighbourhood / borough label. Never required. */
export async function areaLabelFor(coord: LatLng): Promise<string | null> {
  try {
    const rows = await Location.reverseGeocodeAsync(coord);
    const row = rows[0];
    if (!row) return null;
    const parts = [row.district, row.subregion, row.city, row.name].filter(
      (p): p is string => Boolean(p && p.trim()),
    );
    const unique: string[] = [];
    for (const p of parts) {
      if (!unique.some((u) => u.toLowerCase() === p.toLowerCase())) unique.push(p);
    }
    return unique.slice(0, 2).join(', ') || null;
  } catch {
    return null;
  }
}
