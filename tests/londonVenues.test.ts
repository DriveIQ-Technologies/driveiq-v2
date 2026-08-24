import { describe, expect, it } from 'vitest';

import { findLondonPlace, isInDriveIQArea, resolveEventPlace } from '@/data/londonVenues';

describe('findLondonPlace — specific aliases must beat generic ones', () => {
  it('does not pin Wimbledon tennis at AFC Wimbledon', () => {
    expect(findLondonPlace('Wimbledon Championships')?.venue).toMatch(/tennis|wimbledon/i);
    expect(findLondonPlace('All England Lawn Tennis Club')?.venue).toBe(
      findLondonPlace('Wimbledon Championships')?.venue,
    );
    // The football club still resolves to its own ground.
    expect(findLondonPlace('AFC Wimbledon')?.venue).not.toBe(
      findLondonPlace('Wimbledon Championships')?.venue,
    );
  });

  it('does not pin Wembley Park theatre shows at the stadium', () => {
    expect(findLondonPlace('Troubadour Wembley Park Theatre')?.venue).toBe(
      'Troubadour Wembley Park Theatre',
    );
    expect(findLondonPlace('Wembley Park Theatre')?.venue).toBe(
      'Troubadour Wembley Park Theatre',
    );
    expect(findLondonPlace('Wembley Stadium')?.venue).toBe('Wembley Stadium');
  });

  it('does not treat Adelaide Oval as Kennington Oval', () => {
    expect(findLondonPlace('Adelaide Oval')).toBeNull();
    expect(findLondonPlace('Karen Rolton Oval')).toBeNull();
    expect(findLondonPlace('The Oval')?.venue).toBeTruthy();
  });

  it('separates Wembley Stadium from OVO Arena Wembley', () => {
    const stadium = findLondonPlace('Wembley Stadium');
    const arena = findLondonPlace('Wembley Arena');
    expect(stadium?.venue).toBe('Wembley Stadium');
    expect(arena?.venue).toBe('OVO Arena Wembley');
    expect(findLondonPlace('OVO Arena Wembley')?.venue).toBe('OVO Arena Wembley');
  });

  it('resolves every spelling of the Oval to the same ground', () => {
    const canonical = findLondonPlace('The Oval')?.venue;
    expect(canonical).toBeTruthy();
    expect(findLondonPlace('Kia Oval')?.venue).toBe(canonical);
    expect(findLondonPlace('Kennington Oval')?.venue).toBe(canonical);
  });

  it('only treats a bare "England" as Wembley, never a longer England side', () => {
    expect(findLondonPlace('England')?.venue).toBe('Wembley Stadium');
    // A cricket or rugby England side must not be dragged to Wembley; it
    // either resolves to its real ground or not at all.
    expect(findLondonPlace('England Cricket Team')?.venue).not.toBe('Wembley Stadium');
    expect(findLondonPlace('England Women Cricket')?.venue).not.toBe('Wembley Stadium');
  });

  it('tries later candidates when the first is unknown', () => {
    expect(findLondonPlace('Unknown Ground', 'Arsenal')?.venue).toBeTruthy();
  });

  it('does not pin a London club’s away day at their home ground', () => {
    expect(resolveEventPlace('Old Trafford', 'Arsenal')).toBeNull();
    expect(resolveEventPlace(undefined, 'Arsenal')?.venue).toBe('Emirates Stadium');
    expect(resolveEventPlace('Emirates Stadium', 'Chelsea')?.venue).toBe(
      'Emirates Stadium',
    );
  });

  it('returns null rather than guessing', () => {
    expect(findLondonPlace('Camp Nou')).toBeNull();
    expect(findLondonPlace(undefined, null, '')).toBeNull();
  });
});

describe('isInDriveIQArea', () => {
  it('accepts London and the surrounding coverage ring', () => {
    expect(isInDriveIQArea(51.5074, -0.1278)).toBe(true); // central London
    expect(isInDriveIQArea(51.6562, -0.4103)).toBe(true); // Watford
  });

  it('rejects events far outside the coverage box', () => {
    expect(isInDriveIQArea(53.4808, -2.2426)).toBe(false); // Manchester
    expect(isInDriveIQArea(51.4545, -2.5879)).toBe(false); // Bristol
  });
});
