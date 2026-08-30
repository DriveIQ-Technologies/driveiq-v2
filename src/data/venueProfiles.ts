/**
 * Top-venue knowledge for event normalisation (task 08).
 *
 * The nightly job must not overwrite Firestore `eventOverrides` / `venueOverrides`.
 * These numbers are the starting point so cards read correctly before that
 * job is deployed. Capacities are published figures, rounded for ranges.
 */

export interface VenueProfile {
  /** Names we match against, already lowercased. */
  names: string[];
  capacity: number;
  /** Sports: minutes before kick-off that doors typically open. */
  sportsDoorsBeforeMin?: number;
  /** Concerts: listed start is usually doors. Real start is this many minutes later. */
  concertStartAfterDoorsMin?: number;
  /** Concerts: typical London finish, HH:mm. */
  concertFinishHhmm?: string;
}

export const VENUE_PROFILES: VenueProfile[] = [
  {
    names: ['wembley stadium'],
    capacity: 90000,
    sportsDoorsBeforeMin: 90,
    concertStartAfterDoorsMin: 90,
    concertFinishHhmm: '23:00',
  },
  {
    names: ['the o2 arena', 'o2 arena', 'the o2'],
    capacity: 20000,
    concertStartAfterDoorsMin: 60,
    concertFinishHhmm: '23:00',
  },
  {
    names: ['ovo arena wembley', 'wembley arena'],
    capacity: 12500,
    concertStartAfterDoorsMin: 60,
    concertFinishHhmm: '22:45',
  },
  {
    names: [
      'troubadour wembley park theatre',
      'wembley park theatre',
      'troubadour theatre',
    ],
    capacity: 2000,
    concertStartAfterDoorsMin: 30,
  },
  {
    names: ['victoria park', 'victoria park london'],
    capacity: 40000,
    concertStartAfterDoorsMin: 60,
    concertFinishHhmm: '22:30',
  },
  {
    names: ['the national bowl', 'national bowl', 'milton keynes bowl'],
    capacity: 65000,
    concertStartAfterDoorsMin: 75,
    concertFinishHhmm: '23:00',
  },
  {
    names: ['hyde park'],
    capacity: 65000,
    concertStartAfterDoorsMin: 75,
    concertFinishHhmm: '22:30',
  },
  {
    names: ['crystal palace bowl'],
    capacity: 20000,
    concertStartAfterDoorsMin: 60,
    concertFinishHhmm: '22:30',
  },
  {
    names: ['finsbury park'],
    capacity: 45000,
    concertStartAfterDoorsMin: 60,
    concertFinishHhmm: '22:30',
  },
  {
    names: ['boston manor park', 'boston manor'],
    capacity: 25000,
    concertStartAfterDoorsMin: 60,
    concertFinishHhmm: '22:30',
  },
  {
    names: ['gunnersbury park'],
    capacity: 25000,
    concertStartAfterDoorsMin: 60,
    concertFinishHhmm: '22:30',
  },
  {
    names: ['burgess park'],
    capacity: 15000,
    concertStartAfterDoorsMin: 60,
    concertFinishHhmm: '22:00',
  },
  {
    names: ['tottenham hotspur stadium'],
    capacity: 62850,
    sportsDoorsBeforeMin: 90,
    concertStartAfterDoorsMin: 75,
    concertFinishHhmm: '23:00',
  },
  {
    names: ['emirates stadium', 'emirates'],
    capacity: 60704,
    sportsDoorsBeforeMin: 90,
  },
  {
    names: ['twickenham stadium', 'twickenham'],
    capacity: 82223,
    sportsDoorsBeforeMin: 90,
  },
  {
    names: ['royal albert hall', 'albert hall'],
    capacity: 5272,
    // Listed time is curtain, not doors. Proms publish circa end times —
    // do not clamp every night to 22:30.
    concertStartAfterDoorsMin: 30,
  },
  {
    names: ['london stadium'],
    capacity: 62500,
    sportsDoorsBeforeMin: 90,
    concertStartAfterDoorsMin: 75,
    concertFinishHhmm: '23:00',
  },
  {
    names: ['stamford bridge'],
    capacity: 40341,
    sportsDoorsBeforeMin: 90,
  },
  {
    names: ["lord's", "lord's cricket ground", 'lords'],
    capacity: 31100,
    sportsDoorsBeforeMin: 60,
  },
  {
    names: ['the oval', 'kia oval', 'kennington oval'],
    capacity: 27500,
    sportsDoorsBeforeMin: 60,
  },
  {
    names: ['selhurst park'],
    capacity: 25486,
    sportsDoorsBeforeMin: 75,
  },
  {
    names: ['craven cottage'],
    capacity: 24500,
    sportsDoorsBeforeMin: 75,
  },
  {
    names: ['gtech community stadium'],
    capacity: 17250,
    sportsDoorsBeforeMin: 75,
  },
  {
    names: ['alexandra palace', 'ally pally'],
    capacity: 10250,
    concertStartAfterDoorsMin: 45,
    concertFinishHhmm: '22:30',
  },
  {
    names: ['all england lawn tennis club', 'all england club', 'wimbledon'],
    capacity: 15000,
    sportsDoorsBeforeMin: 60,
  },
  {
    names: ['ascot racecourse', 'ascot'],
    capacity: 70000,
    sportsDoorsBeforeMin: 90,
  },
  {
    names: ['eventim apollo', 'hammersmith apollo'],
    capacity: 5039,
    concertStartAfterDoorsMin: 45,
    concertFinishHhmm: '22:30',
  },
  {
    names: ['o2 academy brixton', 'brixton academy'],
    capacity: 4921,
    concertStartAfterDoorsMin: 45,
    concertFinishHhmm: '23:00',
  },
  {
    names: ['roundhouse'],
    capacity: 3300,
    concertStartAfterDoorsMin: 45,
    concertFinishHhmm: '22:30',
  },
];

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

export function venueProfileFor(venue: string | undefined | null): VenueProfile | null {
  if (!venue) return null;
  const n = norm(venue);
  if (!n) return null;
  for (const profile of VENUE_PROFILES) {
    if (profile.names.some((name) => n === name)) return profile;
  }
  for (const profile of VENUE_PROFILES) {
    if (profile.names.some((name) => name.length >= 12 && n.includes(name))) {
      return profile;
    }
  }
  return null;
}

/** Occupancy band by event type. Returned as 0-1 fractions. */
export function occupancyBand(subCategory: string | undefined, isSports: boolean): {
  low: number;
  high: number;
} {
  const kind = (subCategory ?? '').toLowerCase();
  if (isSports || kind.includes('football') || kind.includes('rugby')) {
    return { low: 0.8, high: 1 };
  }
  if (kind.includes('cricket')) return { low: 0.35, high: 0.75 };
  if (kind.includes('tennis') || kind.includes('racing') || kind.includes('horse')) {
    return { low: 0.5, high: 0.9 };
  }
  if (kind.includes('theatre') || kind.includes('comedy') || kind.includes('arts')) {
    return { low: 0.7, high: 0.95 };
  }
  if (kind.includes('family') || kind.includes('kids') || kind.includes('children')) {
    return { low: 0.5, high: 0.85 };
  }
  return { low: 0.75, high: 1 };
}

/** A 90k stadium profile must not dress a 2k theatre show. */
export function profileFitsEvent(
  profile: VenueProfile,
  event: { category?: string; title?: string; subCategory?: string },
): boolean {
  if (profile.capacity < 40000) return true;
  const hay = `${event.title ?? ''} ${event.subCategory ?? ''}`.toLowerCase();
  const intimate =
    event.category === 'theatre' ||
    event.category === 'family' ||
    event.category === 'comedy' ||
    /theatre|theater|musical|comedy|family|kids|children|dinosaur|ballet|opera/.test(
      hay,
    );
  return !intimate;
}

export function turnoutRange(
  capacity: number,
  band: { low: number; high: number },
): { min: number; max: number } {
  const round = (n: number) => {
    if (n >= 10000) return Math.round(n / 1000) * 1000;
    if (n >= 1000) return Math.round(n / 500) * 500;
    return Math.round(n / 100) * 100;
  };
  let min = round(capacity * band.low);
  let max = round(capacity * band.high);
  if (min < 100) min = 100;
  if (max <= min) max = min + (capacity >= 10000 ? 1000 : 100);
  return { min, max };
}
