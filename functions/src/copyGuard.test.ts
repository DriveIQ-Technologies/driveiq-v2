import { describe, expect, it } from 'vitest';

import { isUsableCopyLine } from './copy.js';

describe('isUsableCopyLine', () => {
  it('rejects the exact refusal that reached a real phone', () => {
    // Sent as the body of a Great Western Railway alert, 23 Sep 2026.
    const actual =
      "I can't phrase this record. There isn't enough useful information to alert " +
      "a driver about. You've given me the operator and that it's a special " +
      'service, but no route, time, station, or what the service affects.\n\n' +
      'Send me: the line or route, the time it runs';
    expect(isUsableCopyLine(actual)).toBe(false);
  });

  it('rejects other ways the model talks to us instead of the driver', () => {
    expect(isUsableCopyLine('I cannot write this without more detail.')).toBe(false);
    expect(isUsableCopyLine('Please provide the affected stations.')).toBe(false);
    expect(isUsableCopyLine('As an AI, I need the route.')).toBe(false);
    expect(isUsableCopyLine('Send me: the line, the time')).toBe(false);
  });

  it('rejects anything too long or multi-paragraph to be an alert', () => {
    expect(isUsableCopyLine('x'.repeat(221))).toBe(false);
    expect(isUsableCopyLine('Line one.\n\nLine two.')).toBe(false);
  });

  it('accepts real driver copy', () => {
    expect(isUsableCopyLine('No trains between Didcot Parkway and Reading.')).toBe(true);
    expect(
      isUsableCopyLine('Severe delays on the M25 clockwise. Take a look before you set off.'),
    ).toBe(true);
    expect(isUsableCopyLine('BA2490 is now delayed by 45m.')).toBe(true);
  });

  it('rejects empty or missing copy', () => {
    expect(isUsableCopyLine('')).toBe(false);
    expect(isUsableCopyLine('   ')).toBe(false);
    expect(isUsableCopyLine(null)).toBe(false);
    expect(isUsableCopyLine(undefined)).toBe(false);
  });
});
