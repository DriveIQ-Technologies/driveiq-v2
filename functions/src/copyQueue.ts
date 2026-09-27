import type { Firestore } from 'firebase-admin/firestore';

import { isUsableCopyLine } from './copy.js';

export type CopyKind = 'road' | 'rail' | 'flight' | 'event';

export async function enqueueCopy(
  db: Firestore,
  id: string,
  opts: {
    kind: CopyKind;
    rawRecord: string;
    collection?: string;
    model?: 'haiku' | 'sonnet';
  },
): Promise<void> {
  const raw = opts.rawRecord.trim();
  if (!raw) return;
  const collection = opts.collection ?? opts.kind;

  // Skip anything we have already written copy for. Road incidents and line
  // statuses were re-queued on every 5-minute run whether or not they had
  // changed, so the same incident text was sent to the model up to 288 times a
  // day — the bulk of the AI bill. One Firestore read is far cheaper than a
  // model call. Re-phrase only when the record itself changes, or when the
  // stored line is unusable (e.g. a refusal saved before the guard existed).
  const existing = (await db.doc(`copy/${collection}/lines/${id}`).get()).data();
  if (existing && existing.rawRecord === raw && isUsableCopyLine(existing.line)) {
    return;
  }

  await db.doc(`copyQueue/${id}`).set(
    {
      kind: opts.kind,
      rawRecord: raw,
      collection,
      model: opts.model ?? (opts.kind === 'event' ? 'sonnet' : 'haiku'),
      enqueuedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}
