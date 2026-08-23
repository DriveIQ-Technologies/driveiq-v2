/**
 * TfL Line Status — current status for tube, overground, DLR, Elizabeth, tram
 * and national rail lines into London.
 *
 * Docs: https://api.tfl.gov.uk/swagger/ui/index.html#!/Line/Line_StatusByMode
 *
 * Severity scale (TfL): 0/1=closure, 2=suspended, 3=part-suspended, 4=planned,
 * 5=part-closure, 6=severe-delays, 7=reduced, 8=bus-replacement, 9=minor,
 * 10=good service. We collapse this into UI-friendly buckets.
 */

const APP_KEY = process.env.EXPO_PUBLIC_TFL_APP_KEY ?? '';
const MODES = 'tube,overground,dlr,elizabeth-line,tram,national-rail';
const ENDPOINT = `https://api.tfl.gov.uk/Line/Mode/${MODES}/Status`;

export type LineSeverityBucket = 'good' | 'minor' | 'severe' | 'closed';

export interface LineStatus {
  id: string;
  name: string;
  modeName: string;
  severityBucket: LineSeverityBucket;
  statusDescription: string;
  reason?: string;
}

interface RawValidityPeriod {
  fromDate?: string;
  toDate?: string;
  isNow?: boolean;
}

interface RawLineStatus {
  statusSeverity: number;
  statusSeverityDescription: string;
  reason?: string;
  validityPeriods?: RawValidityPeriod[];
}

/**
 * Is this status entry in force RIGHT NOW?
 *
 * TfL keeps expired and future-planned disruption entries in the feed —
 * National Rail operators especially leave engineering notices (with links to
 * weeks-old incident webpages) hanging around long after they've ended. We
 * were showing every entry regardless, which is why the Connections panel
 * cited stale disruptions (reported 6 July 2026). Only entries whose validity
 * window covers the current time count; entries with no validity info are
 * assumed live (that's how TfL ships real-time tube statuses).
 */
const isActiveNow = (s: RawLineStatus, now: number = Date.now()): boolean => {
  const periods = s.validityPeriods ?? [];
  if (periods.length === 0) return true;
  return periods.some((p) => {
    if (p.isNow) return true;
    const from = p.fromDate ? Date.parse(p.fromDate) : NaN;
    const to = p.toDate ? Date.parse(p.toDate) : NaN;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
    return now >= from && now <= to;
  });
};

interface RawLine {
  id: string;
  name: string;
  modeName: string;
  lineStatuses: RawLineStatus[];
}

/**
 * Keep the Connections panel focused on lines London drivers/riders actually
 * use day to day. TfL's national-rail mode also includes long-distance
 * operators (CrossCountry, Transport for Wales, etc.) whose broad operator
 * notices create noisy false alarms in-app.
 */
const CONNECTION_NATIONAL_RAIL_IDS = new Set([
  'c2c',
  'chiltern-railways',
  'east-midlands-railway',
  'gatwick-express',
  'great-northern',
  'greater-anglia',
  'heathrow-express',
  'southern',
  'south-western-railway',
  'southeastern',
  'thameslink',
]);

const isConnectionLine = (line: Pick<RawLine, 'id' | 'modeName'>): boolean =>
  line.modeName !== 'national-rail' || CONNECTION_NATIONAL_RAIL_IDS.has(line.id);

const effectiveSeverity = (
  modeName: string,
  status: Pick<RawLineStatus, 'statusSeverity' | 'statusSeverityDescription'> | null,
): number => {
  const sev = status?.statusSeverity ?? 10;
  const desc = status?.statusSeverityDescription?.trim().toLowerCase() ?? '';
  // TfL uses "Special Service" for many National Rail operator notices. These
  // are often altered-service advisories, not hard closures, so showing them as
  // "Closed / suspended" is too aggressive and was causing false alarms.
  if (modeName === 'national-rail' && desc === 'special service') return 9;
  return sev;
};

const effectiveStatusDescription = (
  modeName: string,
  status: Pick<RawLineStatus, 'statusSeverityDescription'> | null,
): string => {
  const desc = status?.statusSeverityDescription?.trim();
  if (modeName === 'national-rail' && desc === 'Special Service') {
    return 'Operator notice';
  }
  return desc || 'Good service';
};

const bucket = (sev: number): LineSeverityBucket => {
  if (sev >= 10) return 'good';
  if (sev <= 2) return 'closed';
  if (sev <= 6) return 'severe';
  return 'minor';
};

export const SEVERITY_RANK: Record<LineSeverityBucket, number> = {
  closed: 0,
  severe: 1,
  minor: 2,
  good: 3,
};

export const SEVERITY_COLOR: Record<LineSeverityBucket, string> = {
  good: '#26C281',
  minor: '#FACC15',
  severe: '#F97316',
  closed: '#DC2626',
};

export const SEVERITY_LABEL: Record<LineSeverityBucket, string> = {
  good: 'Good service',
  minor: 'Minor disruption',
  severe: 'Severe disruption',
  closed: 'Closed / suspended',
};

const STATUS_TTL_MS = 45_000;
let allLinesCache: { at: number; data: LineStatus[] } | null = null;
const byIdsCache = new Map<string, { at: number; data: LineStatus[] }>();

export async function fetchLineStatuses(): Promise<LineStatus[]> {
  if (allLinesCache && Date.now() - allLinesCache.at < STATUS_TTL_MS && allLinesCache.data.length) {
    return allLinesCache.data;
  }
  // Cache-buster + no-store: intermediate CDN/HTTP caches must never serve a
  // stale copy of a "live status" response.
  const url = `${ENDPOINT}?_=${Date.now()}${APP_KEY ? `&app_key=${encodeURIComponent(APP_KEY)}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    console.warn('[tfl-lines] network error', e);
    return allLinesCache?.data ?? [];
  }
  if (!res.ok) {
    console.warn('[tfl-lines] non-OK', res.status);
    return allLinesCache?.data ?? [];
  }

  const raw = (await res.json()) as RawLine[];
  const out: LineStatus[] = raw.filter(isConnectionLine).map((l) => mapRawLine(l));

  // Sort: worst-first so problems surface at the top of the panel.
  out.sort((a, b) => SEVERITY_RANK[a.severityBucket] - SEVERITY_RANK[b.severityBucket]);
  console.log(`[tfl-lines] ${out.length} lines (${out.filter((l) => l.severityBucket !== 'good').length} disrupted)`);
  if (out.length > 0) allLinesCache = { at: Date.now(), data: out };
  return out.length > 0 ? out : allLinesCache?.data ?? [];
}

/**
 * Fetch statuses for an explicit set of line ids (station hubs). Unlike
 * `fetchLineStatuses`, this does NOT apply the day-to-day Connections
 * allowlist — termini need GWR / Avanti / etc. even when the main list
 * stays quieter.
 */
export async function fetchLineStatusesByIds(
  lineIds: string[],
): Promise<LineStatus[]> {
  const unique = Array.from(new Set(lineIds.filter(Boolean)));
  if (unique.length === 0) return [];
  const cacheKey = unique.slice().sort().join(',');
  const cached = byIdsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < STATUS_TTL_MS && cached.data.length) {
    return cached.data;
  }

  const url = `https://api.tfl.gov.uk/Line/${unique
    .map(encodeURIComponent)
    .join(',')}/Status?_=${Date.now()}${
    APP_KEY ? `&app_key=${encodeURIComponent(APP_KEY)}` : ''
  }`;

  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    console.warn('[tfl-lines] byIds network error', e);
    return cached?.data ?? [];
  }
  if (!res.ok) {
    console.warn('[tfl-lines] byIds non-OK', res.status);
    return cached?.data ?? [];
  }

  const raw = (await res.json()) as RawLine[];
  const out = raw.map((l) => mapRawLine(l));
  out.sort((a, b) => SEVERITY_RANK[a.severityBucket] - SEVERITY_RANK[b.severityBucket]);
  if (out.length > 0) byIdsCache.set(cacheKey, { at: Date.now(), data: out });
  return out.length > 0 ? out : cached?.data ?? [];
}

function mapRawLine(l: RawLine): LineStatus {
  const worst = (l.lineStatuses ?? [])
    .filter((s) => isActiveNow(s))
    .reduce<RawLineStatus | null>(
      (acc, s) => (acc == null || s.statusSeverity < acc.statusSeverity ? s : acc),
      null,
    );
  const sev = effectiveSeverity(l.modeName, worst);
  return {
    id: l.id,
    name: l.name,
    modeName: l.modeName,
    severityBucket: bucket(sev),
    statusDescription: effectiveStatusDescription(l.modeName, worst),
    reason: worst?.reason?.trim(),
  };
}

// ---------- Line detail (affected stations + raw disruptions) ----------

export interface AffectedStop {
  id: string;
  name: string;
  /** Optional zone / interchange hint shown beside the stop name. */
  meta?: string;
}

export interface LineDisruption {
  category?: string;
  description: string;
  /** First URL pulled out of the description body, if any. */
  link?: string;
  affectedRoutes?: string[];
  closureText?: string;
}

export interface LineDetail {
  id: string;
  name: string;
  modeName: string;
  severityBucket: LineSeverityBucket;
  statusDescription: string;
  /** Long-form reason text from the worst current status, untrimmed. */
  reason?: string;
  disruptions: LineDisruption[];
  affectedStops: AffectedStop[];
  fetchedAt: number;
}

interface RawDisruption {
  category?: string;
  description?: string;
  affectedRoutes?: { name?: string; routeCode?: string }[];
  closureText?: string;
}

interface RawAffectedStop {
  id?: string;
  naptanId?: string;
  commonName?: string;
  name?: string;
  zone?: string;
  modes?: string[];
}

interface RawLineDetail extends RawLine {
  disruptions?: RawDisruption[];
}

/**
 * Pull the first http(s) URL out of a free-text disruption body so we can
 * surface it as a tappable link in the popup. TfL stuffs full nationalrail.co.uk
 * service-disruption URLs inside `reason` for National Rail operators.
 */
const URL_RE = /https?:\/\/[^\s)]+/i;
export const extractLink = (text: string | undefined): string | undefined => {
  if (!text) return undefined;
  const m = text.match(URL_RE);
  return m ? m[0].replace(/[.,;]+$/, '') : undefined;
};

/**
 * Fetch a single line's full status (worst-status + every disruption row +
 * affected stop list). Endpoint: `/Line/{id}/Status?detail=true`.
 *
 * The TfL response nests `affectedStops` inside each `lineStatuses` entry.
 * We flatten + dedupe by NaPTAN id so the UI can render a simple list.
 */
export async function fetchLineDetail(lineId: string): Promise<LineDetail | null> {
  const url = `https://api.tfl.gov.uk/Line/${encodeURIComponent(
    lineId,
  )}/Status?detail=true&_=${Date.now()}${APP_KEY ? `&app_key=${encodeURIComponent(APP_KEY)}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    console.warn('[tfl-lines] detail network error', e);
    return null;
  }
  if (!res.ok) {
    console.warn('[tfl-lines] detail non-OK', res.status);
    return null;
  }

  const arr = (await res.json()) as RawLineDetail[];
  const raw = arr[0];
  if (!raw) return null;
  // Station hubs open lines outside the day-to-day Connections allowlist
  // (GWR, Avanti, …). Detail by id must still work for those.

  // Only statuses in force right now — expired/planned engineering notices
  // (and their weeks-old incident links) must not surface as current.
  const activeStatuses = (raw.lineStatuses ?? []).filter((s) => isActiveNow(s));
  const worst = activeStatuses.reduce<RawLineStatus | null>(
    (acc, s) => (acc == null || s.statusSeverity < acc.statusSeverity ? s : acc),
    null,
  );
  const sev = effectiveSeverity(raw.modeName, worst);

  // Dedupe affected stops across the ACTIVE status entries.
  const stopMap = new Map<string, AffectedStop>();
  for (const ls of activeStatuses) {
    const stops = (ls as unknown as { affectedStops?: RawAffectedStop[] })
      .affectedStops ?? [];
    for (const s of stops) {
      const id = s.id ?? s.naptanId ?? s.commonName ?? s.name ?? '';
      if (!id) continue;
      if (stopMap.has(id)) continue;
      const name = s.commonName ?? s.name ?? id;
      const meta = s.zone ? `Zone ${s.zone}` : undefined;
      stopMap.set(id, { id, name, meta });
    }
  }

  const disruptions: LineDisruption[] = (raw.disruptions ?? []).map((d) => ({
    category: d.category,
    description: (d.description ?? '').trim(),
    link: extractLink(d.description),
    affectedRoutes: (d.affectedRoutes ?? [])
      .map((r) => r.name ?? r.routeCode)
      .filter((v): v is string => !!v),
    closureText: d.closureText,
  }));

  // If TfL returned no top-level disruptions, synthesise one from the worst
  // line-status entry so the popup always has something concrete to show.
  if (disruptions.length === 0 && worst?.reason) {
    disruptions.push({
      description: worst.reason.trim(),
      link: extractLink(worst.reason),
    });
  }

  // A line that's on Good service right now must not display leftover
  // disruption rows (TfL keeps old/planned notices in `disruptions` with no
  // validity info — the source of the weeks-old webpage links).
  if (bucket(sev) === 'good') disruptions.length = 0;

  return {
    id: raw.id,
    name: raw.name,
    modeName: raw.modeName,
    severityBucket: bucket(sev),
    statusDescription: effectiveStatusDescription(raw.modeName, worst),
    reason: worst?.reason?.trim(),
    disruptions,
    affectedStops: Array.from(stopMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    fetchedAt: Date.now(),
  };
}
