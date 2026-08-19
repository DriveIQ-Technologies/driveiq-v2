import type { AppEvent } from '@/types/event';

/**
 * Add a saved event to the device calendar via `expo-calendar`.
 *
 * Loaded lazily and probed for its native module (same guard as
 * services/notifications.ts) so the bundle keeps building before the package
 * is installed, and the call degrades to a no-op `false` rather than crashing
 * when the native side isn't compiled in.
 *
 * Install to enable: `bunx expo install expo-calendar`, then rebuild.
 */

let _Calendar: any = null;
let _probed = false;

const hasNativeCalendarModule = (): boolean => {
  try {
    const mods = (globalThis as { expo?: { modules?: Record<string, unknown> } })
      .expo?.modules;
    return !!mods && 'ExpoCalendar' in mods;
  } catch {
    return false;
  }
};

const getCalendar = (): any => {
  if (_probed) return _Calendar || null;
  _probed = true;
  if (!hasNativeCalendarModule()) {
    console.warn(
      '[calendar] expo-calendar native module not in this build — ' +
        'add-to-calendar disabled. Run `bunx expo install expo-calendar` and rebuild.',
    );
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _Calendar = require('expo-calendar');
  } catch {
    _Calendar = null;
  }
  return _Calendar;
};

/** Result so the UI can show the right toast. */
export type CalendarResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'denied' | 'error' };

/** Find a writable calendar to drop the event into (default if possible). */
async function pickWritableCalendar(C: any): Promise<string | null> {
  try {
    if (C.getDefaultCalendarAsync) {
      const def = await C.getDefaultCalendarAsync().catch(() => null);
      if (def?.id) return def.id;
    }
  } catch {
    /* fall through to enumerating */
  }
  const cals = await C.getCalendarsAsync(C.EntityTypes?.EVENT);
  const writable = cals.find((c: any) => c.allowsModifications);
  return writable?.id ?? cals[0]?.id ?? null;
}

export async function addEventToCalendar(
  event: AppEvent,
): Promise<CalendarResult> {
  const C = getCalendar();
  if (!C) return { ok: false, reason: 'unavailable' };

  try {
    const perm = await C.requestCalendarPermissionsAsync();
    if (perm?.status !== 'granted') return { ok: false, reason: 'denied' };

    const calendarId = await pickWritableCalendar(C);
    if (!calendarId) return { ok: false, reason: 'error' };

    const start = new Date(event.realStartAt || event.startsAt);
    const end = new Date(event.estimatedFinishAt || event.endsAt || event.startsAt);

    await C.createEventAsync(calendarId, {
      title: event.title,
      startDate: start,
      endDate: end,
      location: event.venue,
      notes: event.description ?? 'Saved from DriveIQ',
      // A device-side alarm 60 min before, mirroring the in-app reminder.
      alarms: [{ relativeOffset: -60 }],
    });
    return { ok: true };
  } catch (e) {
    console.warn('[calendar] add failed', e);
    return { ok: false, reason: 'error' };
  }
}
