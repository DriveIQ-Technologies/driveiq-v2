import { describe, expect, it } from 'vitest';

import { buildWelcomeEmail, firstNameFrom } from './welcomeEmail.js';

describe('firstNameFrom', () => {
  it('takes the first token of a display name', () => {
    expect(firstNameFrom('Ada Lovelace')).toBe('Ada');
    expect(firstNameFrom('  Grace   Hopper ')).toBe('Grace');
    expect(firstNameFrom('Prince')).toBe('Prince');
  });

  it('returns null when there is no usable name', () => {
    expect(firstNameFrom(null)).toBeNull();
    expect(firstNameFrom(undefined)).toBeNull();
    expect(firstNameFrom('')).toBeNull();
    expect(firstNameFrom('   ')).toBeNull();
  });
});

describe('buildWelcomeEmail', () => {
  it('personalises subject and greeting when a name is known', () => {
    const email = buildWelcomeEmail({ displayName: 'Ada Lovelace' });
    expect(email.subject).toBe('Ada, your DriveIQ account is ready');
    expect(email.html).toContain('Welcome, Ada');
    expect(email.text).toContain('Welcome, Ada');
  });

  it('falls back to a generic greeting rather than "Hi ," when unknown', () => {
    const email = buildWelcomeEmail({ displayName: null });
    expect(email.subject).toBe('Your DriveIQ account is ready');
    expect(email.html).toContain('Welcome to DriveIQ');
    expect(email.html).not.toMatch(/Welcome,\s*</);
    expect(email.text).not.toMatch(/Welcome,\s*$/m);
  });

  it('escapes a name so it cannot inject markup', () => {
    const email = buildWelcomeEmail({ displayName: '<script>alert(1)</script>' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('mirrors the in-app free-account copy and stays branded', () => {
    const email = buildWelcomeEmail({ displayName: 'Ada' });
    expect(email.html).toContain('#2D7DF6');
    expect(email.html).toContain('The live London map');
    expect(email.html).toContain('Saves and reminders');
    expect(email.html).toContain('Road, rail and flight alerts');
    expect(email.html).toContain('10 AI questions a day');
  });

  it('keeps Premium to a soft mention, not a hard sell', () => {
    const email = buildWelcomeEmail({ displayName: null });
    expect(email.html).toContain('Premium adds');
    expect(email.subject).not.toMatch(/premium|upgrade/i);
  });
});
