import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { handleEventsAdmin } from './eventsAdmin.js';
import { buildManualEvent, manualEventId, manualToPublished } from './manualEvents.js';
import { dedupeSportsEvents } from './sportsDedupe.js';

const NOW = Date.parse('2026-09-26T09:00:00Z');

const englandSpain = {
  title: 'England v Spain',
  venue: 'Wembley Stadium',
  date: '2026-09-26',
  startTime: '19:45',
  type: 'Football',
};

describe('buildManualEvent', () => {
  it('reads the time as London time (BST in September)', () => {
    const r = buildManualEvent(englandSpain, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.startsAt).toBe('2026-09-26T18:45:00Z');
    expect(r.event.category).toBe('sports');
    expect(r.event.latitude).toBeCloseTo(51.556, 2);
  });

  it('estimates the finish when none is given, and says so', () => {
    const r = buildManualEvent(englandSpain, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.event.endIsEstimated).toBe(true);
    // Football: kick-off plus about two hours.
    expect(Date.parse(r.event.endsAt) - Date.parse(r.event.startsAt)).toBe(115 * 60 * 1000);
  });

  it('treats a finish before the start as after midnight', () => {
    const r = buildManualEvent(
      { ...englandSpain, type: 'Music', startTime: '22:00', endTime: '01:30' },
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.event.endsAt).toBe('2026-09-27T00:30:00Z');
    expect(r.event.endIsEstimated).toBe(false);
    expect(r.event.category).toBe('other');
    // A typed finish must beat the venue's own estimate when published.
    expect(r.event.overrides.estimatedFinishAt).toBe('2026-09-27T00:30:00Z');
  });

  it('turns doors, crowd and note into overrides the app shows', () => {
    const r = buildManualEvent(
      { ...englandSpain, doorsTime: '18:15', crowd: '90,000', note: 'Sold out.' },
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.event.overrides).toEqual({
      doorsAt: '2026-09-26T17:15:00Z',
      realStartAt: '2026-09-26T18:45:00Z',
      turnoutMin: 72000,
      turnoutMax: 90000,
      copyLine: 'Sold out.',
      description: 'Sold out.',
    });
  });

  it('leaves overrides empty when only the basics are given', () => {
    const r = buildManualEvent(englandSpain, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.event.overrides).toEqual({});
  });

  it('rejects doors after the start and a silly crowd', () => {
    expect(buildManualEvent({ ...englandSpain, doorsTime: '20:00' }, NOW).ok).toBe(false);
    expect(buildManualEvent({ ...englandSpain, crowd: 'lots' }, NOW).ok).toBe(false);
    expect(buildManualEvent({ ...englandSpain, crowd: '2000000' }, NOW).ok).toBe(false);
  });

  it('stores the type as the subCategory the app filters on', () => {
    const music = buildManualEvent({ ...englandSpain, type: 'Music' }, NOW);
    if (!music.ok) throw new Error(music.error);
    expect(music.event.subCategory).toBe('Music');
    expect(music.event.category).toBe('other');
  });

  it('uses GMT after the clocks go back', () => {
    const r = buildManualEvent({ ...englandSpain, date: '2026-11-14', startTime: '15:00' }, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.event.startsAt).toBe('2026-11-14T15:00:00Z');
  });

  it('rejects missing fields, past starts and unknown venues', () => {
    expect(buildManualEvent({ ...englandSpain, title: ' ' }, NOW).ok).toBe(false);
    expect(buildManualEvent({ ...englandSpain, venue: 'Nowhere' }, NOW).ok).toBe(false);
    expect(buildManualEvent({ ...englandSpain, date: '2026-09-20' }, NOW).ok).toBe(false);
    expect(buildManualEvent({ ...englandSpain, type: 'Darts' }, NOW).ok).toBe(false);
    expect(buildManualEvent({ ...englandSpain, url: 'javascript:alert(1)' }, NOW).ok).toBe(false);
  });

  it('accepts another venue only inside the London area', () => {
    const other = { ...englandSpain, venue: 'other', venueName: 'Hackney Marshes' };
    expect(buildManualEvent({ ...other, latitude: 51.556, longitude: -0.03 }, NOW).ok).toBe(true);
    // Manchester.
    expect(buildManualEvent({ ...other, latitude: 53.48, longitude: -2.24 }, NOW).ok).toBe(false);
  });

  it('gives the same id when the same fixture is saved twice', () => {
    const a = buildManualEvent(englandSpain, NOW);
    const b = buildManualEvent({ ...englandSpain, endTime: '21:45' }, NOW);
    if (!a.ok || !b.ok) throw new Error('build failed');
    expect(manualEventId(a.event)).toBe(manualEventId(b.event));
    expect(manualEventId(a.event)).toBe('2026-09-26-england-v-spain');
  });
});

describe('manual events and feed duplicates', () => {
  it('keeps the hand-added listing over the league feed', () => {
    const r = buildManualEvent(englandSpain, NOW);
    if (!r.ok) throw new Error(r.error);
    const manual = manualToPublished('2026-09-26-england-v-spain', r.event);
    const espn = { ...manual, id: 'espn-1', source: 'espn', title: 'England vs Spain' };
    const out = dedupeSportsEvents([espn, manual]);
    expect(out.map((e) => e.id)).toEqual(['manual-2026-09-26-england-v-spain']);
  });
});

describe('handleEventsAdmin', () => {
  function fakeRes() {
    const r = { code: 0, body: '', status(c: number) { r.code = c; return r; }, set() { return r; }, send(b: string) { r.body = b; } };
    return r;
  }

  it('writes nothing without the right passcode', async () => {
    vi.useFakeTimers();
    const set = vi.fn();
    const db = { doc: vi.fn(() => ({ set, delete: vi.fn() })), collection: vi.fn() };
    const res = fakeRes();
    const done = handleEventsAdmin({
      db: db as never,
      req: { method: 'POST', body: { action: 'add', key: 'wrong', ...englandSpain } },
      res,
      adminKey: 'right-passcode',
      republish: vi.fn(),
    });
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(res.code).toBe(401);
    expect(set).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('refuses everything when no passcode is configured', async () => {
    vi.useFakeTimers();
    const db = { doc: vi.fn(), collection: vi.fn() };
    const res = fakeRes();
    const done = handleEventsAdmin({
      db: db as never,
      req: { method: 'POST', body: { action: 'list', key: '' } },
      res,
      adminKey: undefined,
      republish: vi.fn(),
    });
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(res.code).toBe(401);
    expect(db.doc).not.toHaveBeenCalled();
  });

  it('escapes saved text when listing events', async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const built = buildManualEvent({ ...englandSpain, date: tomorrow });
    if (!built.ok) throw new Error(built.error);
    const doc = { ...built.event, title: '<script>x</script>' };
    const db = {
      doc: vi.fn(() => ({ get: async () => ({ exists: false, data: () => undefined }) })),
      collection: vi.fn(() => ({ limit: () => ({ get: async () => ({ docs: [{ id: 'a', data: () => doc }] }) }) })),
    };
    const res = fakeRes();
    await handleEventsAdmin({
      db: db as never,
      req: { method: 'POST', body: { action: 'list', key: 'right' } },
      res,
      adminKey: 'right',
      republish: vi.fn(),
    });
    expect(res.code).toBe(200);
    expect(res.body).not.toContain('<script>x</script>');
    expect(res.body).toContain('&#60;script&#62;');
  });
});
