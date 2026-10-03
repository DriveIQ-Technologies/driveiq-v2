/**
 * Pure rules behind the dashboard numbers — no Firebase here, so they are
 * unit-tested on their own (see metrics.test.ts).
 */

// ── AI cost ────────────────────────────────────────────────────────────────

/** USD per million tokens. Cache writes use the 1-hour TTL rate (2× input). */
export const MODEL_PRICES: Record<
  string,
  { input: number; output: number; cacheWrite: number; cacheRead: number }
> = {
  haiku: { input: 1, output: 5, cacheWrite: 2, cacheRead: 0.1 },
  sonnet: { input: 3, output: 15, cacheWrite: 6, cacheRead: 0.3 },
};

export interface AiCostRow {
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationTokens?: number | null;
  cacheReadTokens?: number | null;
}

/** Estimated USD for one assistant answer. Unknown models price as Sonnet. */
export function estimateCostUsd(row: AiCostRow): number {
  const p = MODEL_PRICES[String(row.model ?? '').toLowerCase()] ?? MODEL_PRICES.sonnet;
  const m = 1_000_000;
  return (
    ((row.inputTokens ?? 0) * p.input +
      (row.outputTokens ?? 0) * p.output +
      (row.cacheCreationTokens ?? 0) * p.cacheWrite +
      (row.cacheReadTokens ?? 0) * p.cacheRead) /
    m
  );
}

// ── Feed health ────────────────────────────────────────────────────────────

export type Health = 'ok' | 'late' | 'down' | 'unknown';

/**
 * A feed is late once it has missed a run (over 2× its schedule) and down once
 * it has missed several (over 6×). `everyMinutes` is how often it should run.
 */
export function feedHealth(updatedAtIso: string | null | undefined, everyMinutes: number, now = Date.now()): Health {
  const t = Date.parse(String(updatedAtIso ?? ''));
  if (!Number.isFinite(t)) return 'unknown';
  const ageMin = (now - t) / 60_000;
  if (ageMin <= everyMinutes * 2) return 'ok';
  if (ageMin <= everyMinutes * 6) return 'late';
  return 'down';
}

export function ageLabel(updatedAtIso: string | null | undefined, now = Date.now()): string {
  const t = Date.parse(String(updatedAtIso ?? ''));
  if (!Number.isFinite(t)) return 'never';
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min ago`;
  return `${Math.floor(h / 24)} days ago`;
}

// ── Waitlist codes ─────────────────────────────────────────────────────────

export interface WaitlistTokenRow {
  email?: string | null;
  active?: boolean | null;
  usedCount?: number | null;
  maxUses?: number | null;
  expiresAt?: string | null;
  claimedByUid?: string | null;
  claimedAt?: string | null;
  premiumUntil?: string | null;
}

export type WaitlistStatus = 'week-running' | 'week-ended' | 'unclaimed' | 'expiring' | 'expired' | 'disabled';

/** "Expiring" = unclaimed with under 3 days left: chase these. */
export function waitlistStatus(t: WaitlistTokenRow, now = Date.now()): WaitlistStatus {
  if (t.claimedByUid || (t.usedCount ?? 0) > 0) {
    const until = Date.parse(String(t.premiumUntil ?? ''));
    return Number.isFinite(until) && until > now ? 'week-running' : 'week-ended';
  }
  if (t.active === false) return 'disabled';
  const exp = Date.parse(String(t.expiresAt ?? ''));
  if (Number.isFinite(exp) && exp <= now) return 'expired';
  if (Number.isFinite(exp) && exp - now < 3 * 24 * 60 * 60 * 1000) return 'expiring';
  return 'unclaimed';
}

export function countBy<T, K extends string>(items: T[], key: (t: T) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** YYYY-MM-DD in London, for per-day charts. */
export function londonDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** The last `days` London dates, oldest first. */
export function lastDays(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(londonDay(new Date(now - i * 86_400_000).toISOString()));
  return out;
}

/**
 * Paid plan only. A waitlist week is not Premium — that lives on the
 * waitlist token, and must not be passed in here.
 */
export function subscriptionPlan(
  user: {
    premiumPlan?: unknown;
    premiumStatus?: unknown;
  },
): { label: string; trial: boolean } {
  const plan = user.premiumPlan === 'monthly' || user.premiumPlan === 'annual' ? user.premiumPlan : null;
  const status = user.premiumStatus === 'trial' || user.premiumStatus === 'active' ? user.premiumStatus : null;
  if (!plan || !status) return { label: 'Free', trial: false };
  return {
    label: plan === 'monthly' ? 'Premium Monthly' : 'Premium Annual',
    trial: status === 'trial',
  };
}

/** Comma-separated admin emails → normalised set. */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}
