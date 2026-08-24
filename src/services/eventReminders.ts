/**
 * When DriveIQ pings a saved event.
 *
 * Drivers care about two moments: leaving for the venue, and leaving before
 * the crowd. Those fire:
 *   - 1 hour before real start (or doors when we have them)
 *   - 25 minutes before estimated finish
 *
 * Used both to schedule OS notifications and to tell the user, in chat or a
 * popup, exactly when they will hear from us.
 */

import type { AppEvent } from '@/types/event';
import { formatEventDate, formatLondonHhmm } from '@/utils/dateFilters';

export const PRE_START_MINUTES = 60;
export const PRE_END_MINUTES = 25;

export interface EventReminderPlan {
  startMs: number | null;
  endMs: number | null;
  preStartAtMs: number | null;
  preEndAtMs: number | null;
  venue: string;
}

const MIN_LEAD_MS = 30_000;

export function eventReminderPlan(
  event: AppEvent,
  nowMs: number = Date.now(),
): EventReminderPlan {
  const startMs = Date.parse(event.realStartAt ?? event.startsAt);
  const endMs = Date.parse(event.estimatedFinishAt ?? event.endsAt ?? '');
  const startOk = Number.isFinite(startMs);
  const endOk = Number.isFinite(endMs);

  const preStartAtMs = startOk ? startMs - PRE_START_MINUTES * 60_000 : null;
  const preEndAtMs = endOk ? endMs - PRE_END_MINUTES * 60_000 : null;

  return {
    startMs: startOk ? startMs : null,
    endMs: endOk ? endMs : null,
    preStartAtMs:
      preStartAtMs != null && preStartAtMs >= nowMs + MIN_LEAD_MS
        ? preStartAtMs
        : null,
    preEndAtMs:
      preEndAtMs != null && preEndAtMs >= nowMs + MIN_LEAD_MS ? preEndAtMs : null,
    venue: event.venue?.trim() || 'the venue',
  };
}

function stamp(ms: number): string {
  return formatEventDate(new Date(ms).toISOString());
}

function hhmm(ms: number): string {
  return formatLondonHhmm(new Date(ms).toISOString());
}

/** Short chat / dialog copy after Remind or Save. */
export function reminderConfirmationCopy(
  event: AppEvent,
  nowMs: number = Date.now(),
): string {
  const plan = eventReminderPlan(event, nowMs);
  const bits: string[] = [];

  if (plan.preStartAtMs != null) {
    bits.push(`1 hour before it starts (${stamp(plan.preStartAtMs)})`);
  }
  if (plan.preEndAtMs != null) {
    bits.push(
      `25 minutes before crowds leave (${hhmm(plan.preEndAtMs)} at ${plan.venue})`,
    );
  }

  if (bits.length === 0) {
    return `Saved “${event.title}”. It is too close to ping you beforehand — keep an eye on the map.`;
  }

  return `Saved “${event.title}”. I will notify you ${bits.join(', and ')}. You can turn this off in Notifications.`;
}

export function reminderDialogMessage(event: AppEvent): string {
  return reminderConfirmationCopy(event);
}
