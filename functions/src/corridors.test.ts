import { describe, expect, it } from 'vitest';

import { buildCorridorBuckets, incidentCorridor, ROAD_CORRIDORS } from '../src/corridors.js';
import { isQuietHours, isAirportPollWindow, addDaysYmd, londonYmd } from '../src/londonTime.js';
import { normalizeFids } from '../src/airports.js';

describe('corridors', () => {
  it('matches M25 incidents', () => {
    const corridor = incidentCorridor({
      id: '1',
      severity: 'Severe',
      category: 'Closure',
      location: 'M25 clockwise J10',
    });
    expect(corridor?.id).toBe('m25');
  });

  it('builds a bucket per corridor', () => {
    const buckets = buildCorridorBuckets([
      {
        id: 'x',
        severity: 'Severe',
        category: 'Accident',
        location: 'M4 near Heathrow',
      },
    ]);
    expect(buckets).toHaveLength(ROAD_CORRIDORS.length);
    expect(buckets.find((b) => b.corridor.id === 'm4')?.status).toBe('incident');
  });
});

describe('londonTime', () => {
  it('detects quiet hours at 03:00 London', () => {
    const d = new Date('2026-08-25T03:00:00+01:00');
    expect(isQuietHours(d)).toBe(true);
  });

  it('adds calendar days to ymd', () => {
    expect(addDaysYmd('2026-08-25', 1)).toBe('2026-08-26');
  });

  it('formats london ymd', () => {
    const ymd = londonYmd(new Date('2026-08-25T12:00:00+01:00'));
    expect(ymd).toBe('2026-08-25');
  });
});

describe('airports normalizeFids', () => {
  it('parses arrivals and departures', () => {
    const flights = normalizeFids({
      arrivals: [
        {
          number: 'BA123',
          status: 'Scheduled',
          airline: { name: 'British Airways' },
          movement: {
            airport: { iata: 'JFK', name: 'New York' },
            scheduledTime: { utc: '2026-08-25 10:00Z', local: '2026-08-25 11:00+01:00' },
          },
        },
      ],
    });
    expect(flights).toHaveLength(1);
    expect(flights[0].flightNumber).toBe('BA123');
    expect(flights[0].direction).toBe('arrival');
  });
});

describe('airport poll window', () => {
  it('allows polling at noon London', () => {
    expect(isAirportPollWindow(new Date('2026-08-25T12:00:00+01:00'))).toBe(true);
  });

  it('blocks polling at 03:00 London', () => {
    expect(isAirportPollWindow(new Date('2026-08-25T03:00:00+01:00'))).toBe(false);
  });
});
