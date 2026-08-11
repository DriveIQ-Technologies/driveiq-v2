/**
 * Free-tier station slot.
 *
 * Station hubs (live line boards for the major termini) are a Pro feature,
 * but every free user gets ONE station of their choice: the first hub they
 * open claims their free slot, and the rest show the upgrade path. Pro users
 * get all hubs. Client proposal 8 Aug 2026.
 */

import { Alert } from 'react-native';
import { getItem, setItem } from './storage';
import { hasProAccess, showProPaywall } from './subscription';
import type { MajorStation } from './stations';

const FREE_STATION_KEY = 'driveiq.freeStation.v1';

export async function getFreeStationId(): Promise<string | null> {
  return (await getItem(FREE_STATION_KEY)) || null;
}

export async function setFreeStationId(id: string): Promise<void> {
  await setItem(FREE_STATION_KEY, id);
}

export type StationGateResult = 'open' | 'blocked';

/**
 * Gate a station hub tap. Resolves 'open' when the sheet should be shown:
 * Pro users always; free users for their claimed station, or — if the slot
 * is unclaimed — after confirming they want to claim it with this station.
 */
export function gateStationAccess(station: MajorStation): Promise<StationGateResult> {
  return new Promise((resolve) => {
    (async () => {
      if (await hasProAccess()) {
        resolve('open');
        return;
      }
      const freeId = await getFreeStationId();
      if (freeId === station.id) {
        resolve('open');
        return;
      }
      if (freeId) {
        showProPaywall('Live boards for every major station');
        resolve('blocked');
        return;
      }
      Alert.alert(
        'Choose your free station',
        `The free plan includes the live line board for one major station. Make ${station.name} your free station? Upgrade to DriveIQ Pro any time for all of them.`,
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve('blocked') },
          {
            text: `Use ${station.name}`,
            onPress: () => {
              void setFreeStationId(station.id);
              resolve('open');
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve('blocked') },
      );
    })();
  });
}
