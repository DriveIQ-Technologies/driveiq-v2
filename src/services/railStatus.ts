/**
 * National Rail operator status, read from the server-side cache.
 *
 * TfL's `national-rail` mode carries no live severity — eight operators sit
 * permanently on "Special Service" pointing at months-old pages. Cloud
 * Functions now poll National Rail's own Service Indicator feed and publish it
 * to `railCache/national`; this reads that.
 *
 * As with the airport caches, the app holds no API key and one server poll
 * serves every user.
 */
import { db, fsApi } from './firebase';
import type { LineDetail, LineSeverityBucket, LineStatus } from './tflLines';

/** Beyond this the statuses are too old to show as current. */
const HARD_MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface RailOperatorDoc {
  code: string;
  name: string;
  lineId: string;
  status: string;
  severity: LineSeverityBucket;
  disruptionCount?: number;
  url?: string;
}

const VALID: ReadonlySet<string> = new Set(['good', 'minor', 'severe', 'closed']);

/**
 * National Rail lines as LineStatus rows, ready to merge with the TfL ones.
 * Returns [] when the cache is missing or stale — callers then simply show
 * nothing for National Rail rather than something wrong.
 */
export async function fetchNationalRailStatuses(): Promise<LineStatus[]> {
  if (!db || !fsApi) return [];
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, 'railCache', 'national'));
    if (!snap.exists()) return [];
    const data = snap.data() as { operators?: RailOperatorDoc[]; updatedAtMs?: number };
    const ageMs = Date.now() - Number(data.updatedAtMs ?? 0);
    if (!Number.isFinite(ageMs) || ageMs > HARD_MAX_AGE_MS) return [];
    if (!Array.isArray(data.operators)) return [];

    return data.operators
      .filter((o) => o && typeof o.lineId === 'string' && o.lineId)
      .map((o) => ({
        id: o.lineId,
        name: o.name || o.lineId,
        modeName: 'national-rail',
        // Guard against an unexpected value reaching the colour maps. An
        // unrecognised status still means something is being reported, so it
        // shows as minor disruption rather than silently as good service.
        severityBucket: (VALID.has(o.severity) ? o.severity : 'minor') as LineSeverityBucket,
        statusDescription: o.status || 'Minor disruption',
        reason: o.url,
      }));
  } catch (e) {
    return [];
  }
}

/**
 * Full detail for one National Rail line, from the same cache the list uses.
 *
 * Tapping a line used to fetch TfL's detail for it, so the sheet showed TfL's
 * "Special Service" and TfL's months-old link while the list above it showed
 * National Rail's real status. Both now read one source. Returns null for
 * lines National Rail doesn't cover (Tube, Overground…), which stay on TfL.
 */
export async function fetchNationalRailDetail(lineId: string): Promise<LineDetail | null> {
  if (!db || !fsApi) return null;
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, 'railCache', 'national'));
    if (!snap.exists()) return null;
    const data = snap.data() as { operators?: RailOperatorDoc[]; updatedAtMs?: number };
    const ageMs = Date.now() - Number(data.updatedAtMs ?? 0);
    if (!Number.isFinite(ageMs) || ageMs > HARD_MAX_AGE_MS) return null;
    const op = (data.operators ?? []).find((o) => o?.lineId === lineId);
    if (!op) return null;
    const severityBucket = (VALID.has(op.severity) ? op.severity : 'minor') as LineSeverityBucket;
    const good = severityBucket === 'good';
    return {
      id: op.lineId,
      name: op.name || op.lineId,
      modeName: 'national-rail',
      severityBucket,
      statusDescription: op.status || 'Good service',
      reason: good ? undefined : op.status,
      // One entry: the disruption the status is about, linked to its current
      // National Rail page (the server picks the newest, not the oldest).
      disruptions: good ? [] : [{ description: op.status, link: op.url }],
      affectedStops: [],
      fetchedAt: Number(data.updatedAtMs ?? Date.now()),
    };
  } catch (e) {
    return null;
  }
}
