/**
 * TfL Road Disruption API — current road incidents across London.
 *
 * Docs: https://api.tfl.gov.uk/swagger/ui/index.html#!/Road/Road_Disruption
 *
 * No key required for low-volume use. Add `EXPO_PUBLIC_TFL_APP_KEY` to bump
 * the rate limit (50 → 500 req/min).
 */

const APP_KEY = process.env.EXPO_PUBLIC_TFL_APP_KEY ?? '';
const ENDPOINT = 'https://api.tfl.gov.uk/Road/all/Disruption';

export type IncidentSeverity = 'Serious' | 'Severe' | 'Moderate' | 'Minimal';

export type IncidentCategory =
  | 'Accident'
  | 'Roadworks'
  | 'Closure'
  | 'Asset issues'
  | 'Network delays'
  | 'Works'
  | 'Event'
  | 'Other';

export interface TrafficIncident {
  id: string;
  severity: IncidentSeverity | string;
  category: IncidentCategory | string;
  subCategory?: string;
  comments?: string;
  location?: string;
  latitude: number;
  longitude: number;
  startsAt?: string;
  endsAt?: string;
  hasClosures: boolean;
}

interface RawDisruption {
  id: string;
  severity?: string;
  category?: string;
  subCategory?: string;
  comments?: string;
  location?: string;
  point?: string; // "[lon,lat]"
  startDateTime?: string;
  endDateTime?: string;
  hasClosures?: boolean;
}

// "[-0.087107,51.616599]" -> { lat: 51.616599, lon: -0.087107 }
const parsePoint = (raw: string | undefined): { lat: number; lon: number } | null => {
  if (!raw) return null;
  const m = raw.match(/-?\d+(\.\d+)?/g);
  if (!m || m.length < 2) return null;
  const lon = parseFloat(m[0]);
  const lat = parseFloat(m[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

export async function fetchTrafficIncidents(): Promise<TrafficIncident[]> {
  const url = APP_KEY
    ? `${ENDPOINT}?stripContent=true&app_key=${encodeURIComponent(APP_KEY)}`
    : `${ENDPOINT}?stripContent=true`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    return [];
  }
  if (!res.ok) {
    return [];
  }

  const raw = (await res.json()) as RawDisruption[];

  const out: TrafficIncident[] = [];
  for (const r of raw) {
    const pt = parsePoint(r.point);
    if (!pt) continue;
    out.push({
      id: r.id,
      severity: (r.severity ?? 'Minimal') as IncidentSeverity,
      category: (r.category ?? 'Other') as IncidentCategory,
      subCategory: r.subCategory,
      comments: r.comments,
      location: r.location,
      latitude: pt.lat,
      longitude: pt.lon,
      startsAt: r.startDateTime,
      endsAt: r.endDateTime,
      hasClosures: !!r.hasClosures,
    });
  }
  return out;
}

/**
 * Keep only "major" incidents — Severe / Serious by TfL severity, plus any
 * closure or collision regardless of severity. Filters out the long tail of
 * Minimal roadworks notices the API returns.
 */
export const isMajorIncident = (i: TrafficIncident): boolean => {
  if (i.severity === 'Severe' || i.severity === 'Serious') return true;
  if (i.hasClosures) return true;
  const cat = (i.category ?? '').toLowerCase();
  if (cat === 'accident' || cat === 'collisions') return true;
  return false;
};

export const incidentColor = (sev: string): string => {
  switch (sev) {
    case 'Severe':
    case 'Serious':
      return '#DC2626';
    case 'Moderate':
      return '#F97316';
    case 'Minimal':
    default:
      return '#FACC15';
  }
};

// Maps a TfL category to an Ionicons glyph name.
export const incidentIconName = (
  category: string,
  hasClosures: boolean,
): 'warning' | 'construct' | 'stop-circle' | 'car' | 'alert-circle' => {
  if (hasClosures) return 'stop-circle';
  switch (category) {
    case 'Accident':
      return 'warning';
    case 'Works':
    case 'Roadworks':
      return 'construct';
    case 'Network delays':
      return 'car';
    default:
      return 'alert-circle';
  }
};
