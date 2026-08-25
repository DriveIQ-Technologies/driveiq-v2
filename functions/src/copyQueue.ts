import type { Firestore } from 'firebase-admin/firestore';

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
  await db.doc(`copyQueue/${id}`).set(
    {
      kind: opts.kind,
      rawRecord: raw,
      collection: opts.collection ?? opts.kind,
      model: opts.model ?? (opts.kind === 'event' ? 'sonnet' : 'haiku'),
      enqueuedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}
