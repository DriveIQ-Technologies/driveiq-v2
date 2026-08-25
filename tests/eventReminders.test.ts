import { describe, expect, it } from 'vitest';

import {
  eventReminderPlan,
  reminderConfirmationCopy,
} from '@/services/eventReminders';
import type { AppEvent } from '@/types/event';

const event: AppEvent = {
  id: 'e1',
  source: 'ticketmaster',
  category: 'other',
  title: 'All Points East',
  startsAt: '2026-08-23T16:00:00+01:00',
  endsAt: '2026-08-23T22:30:00+01:00',
  estimatedFinishAt: '2026-08-23T22:30:00+01:00',
  realStartAt: '2026-08-23T16:00:00+01:00',
  venue: 'Victoria Park',
  latitude: 51.5365,
  longitude: -0.0404,
  subCategory: 'Music',
};

describe('eventReminderPlan', () => {
  it('schedules 1h before start and 25m before finish', () => {
    const now = Date.parse('2026-08-20T12:00:00+01:00');
    const plan = eventReminderPlan(event, now);
    expect(plan.preStartAtMs).toBe(Date.parse('2026-08-23T15:00:00+01:00'));
    expect(plan.preEndAtMs).toBe(Date.parse('2026-08-23T22:05:00+01:00'));
  });

  it('skips pings that would already have fired', () => {
    const now = Date.parse('2026-08-23T21:50:00+01:00');
    const plan = eventReminderPlan(event, now);
    expect(plan.preStartAtMs).toBeNull();
    expect(plan.preEndAtMs).toBe(Date.parse('2026-08-23T22:05:00+01:00'));
  });

  it('tells the user both times in confirmation copy', () => {
    const now = Date.parse('2026-08-20T12:00:00+01:00');
    const copy = reminderConfirmationCopy(event, now);
    expect(copy).toContain('All Points East');
    expect(copy).toContain('1 hour before');
    expect(copy).toContain('25 minutes');
    expect(copy).toContain('Victoria Park');
  });
});
