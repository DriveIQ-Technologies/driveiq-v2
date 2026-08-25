/**
 * City-wide TfL + National Highways ingest. One fetch for all users.
 * Raw records go through copyQueue so Claude voice applies.
 */
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { enqueueCopy } from './copyQueue.js';
import { ingestCorridorRoads, type TrafficIncident } from './corridors.js';

interface RoadRow {
  id?: string;
  severity?: string;
  category?: string;
  comments?: string;
  location?: string;
  currentUpdate?: string;
  hasClosures?: boolean;
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

interface RawHighwayEvent {
  id?: string | number;
  eventCategory?: string;
  description?: string;
  roadNumber?: string;
  severity?: string;
  location?: string;
}

function clean(s?: string): string {
  return (s ?? '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
}

function mapHighwaySeverity(sev: string | undefined): string {
  const s = (sev ?? '').toLowerCase();
  if (s.includes('very high') || s === 'high') return 'Severe';
  if (s.includes('serious')) return 'Serious';
  if (s.includes('medium') || s.includes('moderate')) return 'Moderate';
  return 'Minimal';
}

function mapHighwayCategory(cat: string | undefined): string {
  const c = (cat ?? '').toLowerCase();
  if (c.includes('accident') || c.includes('collision')) return 'Accident';
  if (c.includes('closure')) return 'Closure';
  if (c.includes('roadwork') || c.includes('works')) return 'Roadworks';
  if (c.includes('delay')) return 'Network delays';
  return 'Other';
}

export async function fetchHighwaysIncidents(): Promise<TrafficIncident[]> {
  try {
    const res = await fetch('https://www.trafficengland.com/api/events');
    if (!res.ok) return [];
    const data = (await res.json()) as { events?: RawHighwayEvent[] } | RawHighwayEvent[];
    const rows = Array.isArray(data) ? data : (data.events ?? []);
    return rows.slice(0, 120).map((e) => ({
      id: `nh-${String(e.id ?? e.roadNumber ?? Math.random()).slice(0, 40)}`,
      severity: mapHighwaySeverity(e.severity),
      category: mapHighwayCategory(e.eventCategory),
      location: clean(e.location ?? e.roadNumber ?? e.description),
      comments: clean(e.description),
      hasClosures: mapHighwayCategory(e.eventCategory) === 'Closure',
    }));
  } catch {
    return [];
  }
}

export async function ingestLiveFeeds(db: Firestore): Promise<TrafficIncident[]> {
  const [roadRes, lineRes, nhIncidents] = await Promise.all([
    fetch('https://api.tfl.gov.uk/Road/all/Disruption'),
    fetch(
      'https://api.tfl.gov.uk/Line/Mode/tube,overground,dlr,elizabeth-line,tram,national-rail/Status',
    ),
    fetchHighwaysIncidents(),
  ]);

  const allIncidents: TrafficIncident[] = [...nhIncidents];

  if (roadRes.ok) {
    const rows = (await roadRes.json()) as RoadRow[];
    for (const r of rows) {
      allIncidents.push({
        id: String(r.id ?? 'road').replace(/\//g, '_').slice(0, 80),
        severity: String(r.severity ?? 'Minimal'),
        category: String(r.category ?? 'Other'),
        location: clean(r.location),
        comments: clean(r.currentUpdate || r.comments),
        hasClosures: !!r.hasClosures || /closure/i.test(String(r.category)),
      });
    }
    const major = rows
      .filter((r) => {
        const sev = String(r.severity ?? '').toLowerCase();
        return sev === 'severe' || sev === 'serious';
      })
      .slice(0, 24);
    for (const r of major) {
      const id = String(r.id ?? 'road').replace(/\//g, '_').slice(0, 80);
      const raw = clean(
        [r.severity, r.category, r.location, r.currentUpdate || r.comments]
          .filter(Boolean)
          .join(' · '),
      );
      if (raw) {
        await enqueueCopy(db, `tfl-road-${id}`, {
          kind: 'road',
          rawRecord: raw,
        });
      }
    }
    logger.info('ingest.roads', { count: major.length });
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
    for (const { l, worst } of disrupted) {
      const id = String(l.id ?? l.name ?? 'line').replace(/\//g, '_').slice(0, 80);
      const raw = clean(
        [l.name, worst?.statusSeverityDescription, worst?.reason].filter(Boolean).join(' · '),
      );
      if (raw) {
        await enqueueCopy(db, `tfl-rail-${id}`, {
          kind: 'rail',
          rawRecord: raw,
        });
      }
    }
    logger.info('ingest.rails', { count: disrupted.length });
  } else {
    logger.warn('ingest.rails_http', { status: lineRes.status });
  }

  await ingestCorridorRoads(db, allIncidents);
  return allIncidents;
}
