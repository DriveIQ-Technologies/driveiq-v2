import { describe, expect, it } from 'vitest';

import { buildPremiumWelcomeEmail } from './premiumWelcomeEmail.js';
import { buildWelcomeEmail } from './welcomeEmail.js';

const NOW = new Date('2026-10-05T12:00:00.000Z');

const emails = {
  welcomeFree: () => buildWelcomeEmail({ displayName: 'Ada Lovelace' }),
  welcomeFreeNoName: () => buildWelcomeEmail({ displayName: null }),
  premiumAnnual: () => buildPremiumWelcomeEmail({ plan: 'annual', displayName: 'Ada', now: NOW }),
  premiumMonthly: () => buildPremiumWelcomeEmail({ plan: 'monthly', displayName: null, now: NOW }),
};

describe.each(Object.entries(emails))('%s, as sent', (_name, build) => {
  const { html, text } = build();

  it('has no Brevo tags left for the reader to see', () => {
    // Not `}}` on its own: the CSS media query legitimately ends with it.
    for (const body of [html, text]) {
      expect(body).not.toMatch(/\{%|%\}|\{\{|params\./);
    }
  });

  it('only loads images over https from our own hosts', () => {
    const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    // driveiq.app is the website; driveiq-app.web.app is Firebase Hosting
    // (repo hosting/), where the email images live.
    for (const src of srcs) expect(src).toMatch(/^https:\/\/(driveiq\.app|driveiq-app\.web\.app)\//);
  });

  it('links only to https pages or the support inbox', () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const href of hrefs) expect(href).toMatch(/^(https:\/\/|mailto:hello@driveiq\.app$)/);
  });

  it('is a complete document, well under Gmail clipping (102 KB)', () => {
    expect(html.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(90_000);
  });

  it('carries the company footer', () => {
    expect(html).toContain('DriveIQ Technologies Ltd');
    expect(text).toContain('hello@driveiq.app');
  });
});

describe('premium trial dates', () => {
  it('shows the London end date for trial end, first payment and the charge line', () => {
    const { html } = buildPremiumWelcomeEmail({ plan: 'annual', now: NOW });
    // 7 days after 5 Oct 2026.
    expect(html.match(/12 Oct 2026/g)?.length).toBe(3);
    expect(html).toContain('charged on 12 Oct 2026, then every year after that');
  });
});
