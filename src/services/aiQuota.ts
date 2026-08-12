/**
 * Daily AI-question quota.
 *
 * Free plan gets FREE_DAILY_LIMIT questions per calendar day (local time);
 * Premium is unlimited. Usage resets automatically when the stored day changes.
 * Client tiering 8 Aug 2026.
 */

import { getJSON, setJSON } from './storage';
import { hasProAccess } from './subscription';

const QUOTA_KEY = 'driveiq.aiQuota.v1';

export const FREE_DAILY_LIMIT = 5;

interface StoredQuota {
  /** Local calendar day the counter belongs to, YYYY-MM-DD. */
  day: string;
  used: number;
}

export interface AiQuota {
  pro: boolean;
  used: number;
  /** Infinity for Premium. */
  limit: number;
  /** Infinity for Premium. */
  remaining: number;
}

const todayKey = (): string => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

async function loadUsedToday(): Promise<number> {
  const stored = await getJSON<StoredQuota | null>(QUOTA_KEY, null);
  if (!stored || stored.day !== todayKey()) return 0;
  return stored.used;
}

export async function getAiQuota(): Promise<AiQuota> {
  const pro = await hasProAccess();
  const used = await loadUsedToday();
  if (pro) return { pro, used, limit: Infinity, remaining: Infinity };
  return {
    pro,
    used,
    limit: FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - used),
  };
}

/**
 * Record one question. Returns the quota state AFTER consumption. Callers
 * should check `remaining` on getAiQuota() BEFORE answering; this just
 * persists the tick (Premium usage is tracked but never blocks).
 */
export async function consumeAiQuestion(): Promise<AiQuota> {
  const used = (await loadUsedToday()) + 1;
  await setJSON(QUOTA_KEY, { day: todayKey(), used } satisfies StoredQuota);
  return getAiQuota();
}
