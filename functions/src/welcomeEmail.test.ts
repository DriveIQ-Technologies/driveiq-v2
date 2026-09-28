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
    expect(email.subject).toBe('Ada, welcome to DriveIQ');
    expect(email.html).toContain('Welcome aboard, Ada.');
    expect(email.text).toContain('Welcome aboard, Ada.');
  });

  it('falls back to a generic greeting rather than a dangling comma', () => {
    const email = buildWelcomeEmail({ displayName: null });
    expect(email.subject).toBe('Welcome to DriveIQ');
    expect(email.html).toContain('Welcome aboard.');
    expect(email.html).not.toMatch(/Welcome aboard,/);
    expect(email.html).not.toContain('{%');
    expect(email.text).toContain('Welcome aboard.');
  });

  it('escapes a name so it cannot inject markup', () => {
    const email = buildWelcomeEmail({ displayName: '<script>alert(1)</script>' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('uses the designed free-account pass and first-shift steps', () => {
    const email = buildWelcomeEmail({ displayName: 'Ada' });
    expect(email.html).toContain('DRIVER PASS');
    expect(email.html).toContain('The live London map');
    expect(email.html).toContain('Switch on notifications');
    expect(email.html).toContain("Save tonight's events");
    expect(email.html).toContain('10 questions a day');
    expect(email.html).toContain('PLAN');
    expect(email.html).toContain('>Free<');
  });

  it('keeps the subject off a Premium sell', () => {
    const email = buildWelcomeEmail({ displayName: null });
    expect(email.subject).not.toMatch(/premium|upgrade/i);
    expect(email.html).toContain('Try it free for 7 days.');
  });
});
