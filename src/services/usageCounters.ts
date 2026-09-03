import { auth, db, fsApi } from './firebase';

export type UsageMetric =
  | 'aiQuestions'
  | 'flightsTracked'
  | 'eventsSaved'
  | 'stationsWatched';

function londonDayKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

/**
 * Per-user launch counters used in free-week reconversion messaging.
 */
export async function incrementUsageCounter(
  metric: UsageMetric,
  amount = 1,
): Promise<void> {
  const uid = auth?.currentUser?.uid;
  if (!uid || !db || !fsApi || amount <= 0) return;
  try {
    const day = londonDayKey();
    const ref = fsApi.doc(db, 'users', uid, 'usageDaily', day);
    await fsApi.setDoc(
      ref,
      {
        uid,
        day,
        updatedAt: new Date().toISOString(),
        [metric]: fsApi.increment(amount),
      },
      { merge: true },
    );
  } catch (e) {
    console.warn('[usage] counter update failed', { metric, error: e });
  }
}
