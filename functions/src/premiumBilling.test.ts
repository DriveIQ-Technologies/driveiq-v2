import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  billingUpdateFor,
  dueForTrialReminder,
  handleRevenueCatWebhook,
  handleTrialDay6Reminders,
  webhookAuthorized,
} from './premiumBilling.js';

const brevo = { apiKey: 'k', senderEmail: 'hello@driveiq.app', senderName: 'DriveIQ' };

function userDb(initial: Record<string, unknown> | null) {
  const store: { data: Record<string, unknown> | null } = { data: initial };
  const ref = {
    get: async () => ({ data: () => store.data ?? undefined }),
    set: async (patch: Record<string, unknown>, opts?: { merge?: boolean }) => {
      store.data = opts?.merge ? { ...(store.data ?? {}), ...patch } : { ...patch };
    },
  };
  return { db: { doc: () => ref } as never, store };
}

afterEach(() => vi.unstubAllGlobals());

describe('billingUpdateFor', () => {
  const now = new Date('2026-10-03T09:00:00.000Z');

  it('records a monthly trial and ignores anonymous ids', () => {
    const update = billingUpdateFor(
      {
        type: 'INITIAL_PURCHASE',
        app_user_id: 'uid-1',
        product_id: '$rc_monthly',
        period_type: 'TRIAL',
        expiration_at_ms: Date.parse('2026-10-10T09:00:00.000Z'),
      },
      now,
    );
    expect(update?.patch.premiumStatus).toBe('trial');
    expect(update?.patch.premiumPlan).toBe('monthly');
    expect(update?.sendCancelEmail).toBe(false);
    expect(billingUpdateFor({ type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:abc' }, now)).toBeNull();
  });

  it('emails only when a trial is cancelled', () => {
    const trial = billingUpdateFor(
      { type: 'CANCELLATION', app_user_id: 'uid-1', product_id: 'monthly', period_type: 'TRIAL' },
      now,
    );
    const paid = billingUpdateFor(
      { type: 'CANCELLATION', app_user_id: 'uid-1', product_id: 'annual', period_type: 'NORMAL' },
      now,
    );
    expect(trial?.sendCancelEmail).toBe(true);
    expect(trial?.patch.premiumStatus).toBe('cancelled');
    expect(paid?.sendCancelEmail).toBe(false);
  });
});

describe('dueForTrialReminder', () => {
  it('is the day before the charge, not the charge morning', () => {
    const now = new Date('2026-10-09T09:00:00.000Z');
    expect(dueForTrialReminder(new Date('2026-10-10T09:00:00.000Z'), now)).toBe(true);
    expect(dueForTrialReminder(new Date('2026-10-09T11:00:00.000Z'), now)).toBe(false);
    expect(dueForTrialReminder(new Date('2026-10-12T09:00:00.000Z'), now)).toBe(false);
  });
});

describe('webhookAuthorized', () => {
  it('accepts the raw secret or a bearer token', () => {
    expect(webhookAuthorized('Bearer secret', 'secret')).toBe(true);
    expect(webhookAuthorized('secret', 'secret')).toBe(true);
    expect(webhookAuthorized('nope', 'secret')).toBe(false);
    expect(webhookAuthorized('Bearer secret', '')).toBe(false);
  });
});

describe('handleRevenueCatWebhook', () => {
  it('sends the cancel confirmation once', async () => {
    let postedBody = '';
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      postedBody = String(init?.body ?? '');
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { db, store } = userDb({ email: 'ada@example.com', displayName: 'Ada', premiumPlan: 'monthly' });
    const event = {
      type: 'CANCELLATION',
      app_user_id: 'uid-1',
      product_id: '$rc_monthly',
      period_type: 'TRIAL',
      expiration_at_ms: Date.parse('2026-10-10T09:00:00.000Z'),
    };

    const first = await handleRevenueCatWebhook({ db, brevo, event });
    const second = await handleRevenueCatWebhook({ db, brevo, event });

    expect(first.cancelSent).toBe(true);
    expect(second.cancelSent).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.data?.premiumStatus).toBe('cancelled');
    const posted = JSON.parse(postedBody) as { subject: string };
    expect(posted.subject).toContain('cancelled');
  });
});

describe('handleTrialDay6Reminders', () => {
  it('emails a trial that ends tomorrow and skips a cancelled one', async () => {
    let postedBody = '';
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      postedBody = String(init?.body ?? '');
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const now = new Date('2026-10-09T09:00:00.000Z');
    const rows = [
      {
        id: 'due',
        data: {
          email: 'ada@example.com',
          displayName: 'Ada',
          premiumStatus: 'trial',
          premiumPlan: 'monthly',
          premiumTrialEndsAt: '2026-10-10T09:00:00.000Z',
        },
      },
      {
        id: 'cancelled',
        data: {
          email: 'bea@example.com',
          premiumStatus: 'trial',
          premiumPlan: 'annual',
          premiumTrialEndsAt: '2026-10-10T09:00:00.000Z',
          premiumCancelledAt: '2026-10-08T09:00:00.000Z',
        },
      },
    ];
    const docs = rows.map((row) => ({
      id: row.id,
      data: () => row.data,
      ref: {
        set: async (patch: Record<string, unknown>) => {
          Object.assign(row.data, patch);
        },
      },
    }));
    const db = {
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ docs, size: docs.length }),
          }),
        }),
      }),
    };

    const result = await handleTrialDay6Reminders({ db: db as never, brevo, now: () => now });

    expect(result.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const posted = JSON.parse(postedBody) as {
      subject: string;
      htmlContent: string;
    };
    expect(posted.subject).toContain('tomorrow');
    expect(posted.htmlContent).toContain('£6.99');
    expect(rows[0].data).toHaveProperty('premiumDay6EmailSentAt');
  });
});
