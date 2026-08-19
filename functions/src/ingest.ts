/**
 * City-wide TfL ingest. One fetch for all users, written to Firestore copy
 * lines the agent already reads.
 */
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';

interface RoadRow {
  id?: string;
  severity?: string;
  category?: string;
  comments?: string;
  location?: string;
  currentUpdate?: string;
}

interface LineRow {
  id?: string;
  name?: string;
  modeName?: string;
  lineStatuses?: Array<{
    statusSeverity?: number;
    statusSeverityDescription?: string;
    reason?: string;
  }>;
}

function clean(s?: string): string {
  return (s ?? '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
}

export async function ingestLiveFeeds(db: Firestore): Promise<void> {
  const [roadRes, lineRes] = await Promise.all([
    fetch('https://api.tfl.gov.uk/Road/all/Disruption'),
    fetch(
      'https://api.tfl.gov.uk/Line/Mode/tube,overground,dlr,elizabeth-line,tram,national-rail/Status',
    ),
  ]);

  if (roadRes.ok) {
    const rows = (await roadRes.json()) as RoadRow[];
    const major = rows
      .filter((r) => {
        const sev = String(r.severity ?? '').toLowerCase();
        return sev === 'severe' || sev === 'serious';
      })
      .slice(0, 24);
    const writes = major.map((r) => {
      const id = String(r.id ?? 'road').replace(/\//g, '_').slice(0, 80);
      const line = clean(
        [r.severity, r.category, r.location, r.currentUpdate || r.comments]
          .filter(Boolean)
          .join(' · '),
      );
      return db.doc(`copy/road/lines/${id}`).set(
        {
          line: line || 'Road disruption in London.',
          source: 'tfl',
          kind: 'road',
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    });
    await Promise.all(writes);
    logger.info('ingest.roads', { count: writes.length });
  } else {
    logger.warn('ingest.roads_http', { status: roadRes.status });
  }

  if (lineRes.ok) {
    const rows = (await lineRes.json()) as LineRow[];
    const disrupted = rows
      .map((l) => {
        const worst = (l.lineStatuses ?? []).sort(
          (a, b) => (a.statusSeverity ?? 99) - (b.statusSeverity ?? 99),
        )[0];
        return { l, worst };
      })
      .filter((x) => (x.worst?.statusSeverity ?? 10) < 10)
      .slice(0, 24);
    const writes = disrupted.map(({ l, worst }) => {
      const id = String(l.id ?? l.name ?? 'line').replace(/\//g, '_').slice(0, 80);
      const line = clean(
        [l.name, worst?.statusSeverityDescription, worst?.reason].filter(Boolean).join(' · '),
      );
      return db.doc(`copy/rail/lines/${id}`).set(
        {
          line: line || `${l.name ?? 'Line'} disruption.`,
          source: 'tfl',
          kind: 'rail',
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    });
    await Promise.all(writes);
    logger.info('ingest.rails', { count: writes.length });
  } else {
    logger.warn('ingest.rails_http', { status: lineRes.status });
  }
}
