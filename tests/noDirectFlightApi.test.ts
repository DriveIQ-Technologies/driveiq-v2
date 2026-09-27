/**
 * The app must never call AeroDataBox itself.
 *
 * It used to: every phone called the paid flight API directly, which is what
 * exhausted the quota, and the RapidAPI key shipped inside the app where anyone
 * could extract it. Flights now come only from the server-side cache. This test
 * fails the build if a direct call, or the key, ever creeps back into app code.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_DIRS = ['src', 'app'];
const FORBIDDEN = [
  /aerodatabox\.p\.rapidapi\.com/i,
  /x-rapidapi-key/i,
  /EXPO_PUBLIC_AERODATABOX/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe('flight data comes only from the server', () => {
  it('no app code calls AeroDataBox or reads its key', () => {
    const offenders: string[] = [];
    for (const dir of APP_DIRS) {
      for (const file of sourceFiles(dir)) {
        const text = readFileSync(file, 'utf8');
        for (const re of FORBIDDEN) {
          if (re.test(text)) offenders.push(`${file} matches ${re}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
