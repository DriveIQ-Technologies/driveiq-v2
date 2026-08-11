/**
 * National Highways DATEX II — accidents, closures and major incidents on the
 * Strategic Road Network surrounding London (M1, M11, M20, M23, M25, M3, M4,
 * M40, A1(M), A2, A3(M), A12, A13, A20, A40).
 *
 * Source: https://www.trafficengland.com/api/events  (open JSON feed)
 *
 * The TfL Road Disruption API only covers the GLA boundary, so it misses
 * everything past the M25. We merge this stream into the same
 * `TrafficIncident` shape the UI already renders so map markers and the
 * incident sheet keep working unchanged.
 */

import type { TrafficIncident } from './tflTraffic';

// Roads we surface notifications + map markers for. Anything else in the
// upstream feed is ignored to keep the long tail of minor regional events
// out of London-area users' faces.
const ROADS_OF_INTEREST = new Set<string>([
  'M1', 'M11', 'M2', 'M20', 'M23', 'M25', 'M3', 'M4', 'M40',
  'A1(M)', 'A1', 'A2', 'A3(M)', 'A3', 'A4', 'A10', 'A12', 'A13',
  'A20', 'A40', 'A406', 'A205',
]);

interface RawEvent {
  id?: string | number;
  eventCategory?: string;
  eventReason?: string;
  description?: string;
  roadNumber?: string;
  startCoordinates?: { latitude?: number; longitude?: number };
  endCoordinates?: { latitude?: number; longitude?: number };
  startDate?: string;
  endDate?: string;
  severity?: string;
  location?: string;
}

// Map National Highways categories onto our internal incident category set.
const mapCategory = (cat: string | undefined): TrafficIncident['category'] => {
  const c = (cat ?? '').toLowerCase();
  if (c.includes('accident') || c.includes('collision')) return 'Accident';
  if (c.includes('roadwork') || c.includes('works')) return 'Roadworks';
  if (c.includes('closure')) return 'Closure';
  if (c.includes('delay')) return 'Network delays';
  return 'Other';
};

// Map upstream "severity" strings (Low / Medium / High / Very High) to ours.
const mapSeverity = (sev: string | undefined): TrafficIncident['severity'] => {
  const s = (sev ?? '').toLowerCase();
  if (s.includes('very high') || s === 'high') return 'Severe';
  if (s.includes('serious')) return 'Serious';
  if (s.includes('medium') || s.includes('moderate')) return 'Moderate';
  return 'Minimal';
};

export async function fetchHighwaysIncidents(): Promise<TrafficIncident[]> {
  let res: Response;
  try {
    res = await fetch('https://www.trafficengland.com/api/events');
  } catch (e) {
    console.warn('[highways] network error', e);
    return [];
  }
  if (!res.ok) {
    console.warn('[highways] non-OK', res.status);
    return [];
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    console.warn('[highways] parse error', e);
    return [];
  }

  // Accept both `{ events: [...] }` and a bare array — the feed has shifted
  // shape historically and we want to survive either.
  const arr: RawEvent[] = Array.isArray(data)
    ? (data as RawEvent[])
    : ((data as { events?: RawEvent[] })?.events ?? []);

  const out: TrafficIncident[] = [];
  for (const r of arr) {
    const road = (r.roadNumber ?? '').toUpperCase();
    if (!ROADS_OF_INTEREST.has(road)) continue;
    const lat = r.startCoordinates?.latitude;
    const lon = r.startCoordinates?.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const category = mapCategory(r.eventCategory);
    const severity = mapSeverity(r.severity);

    out.push({
      id: `nh-${r.id ?? `${road}-${lat}-${lon}`}`,
      severity,
      category,
      subCategory: r.eventReason,
      comments: r.description,
      location: r.location ?? road,
      latitude: lat,
      longitude: lon,
      startsAt: r.startDate,
      endsAt: r.endDate,
      hasClosures: category === 'Closure' || (r.eventCategory ?? '').toLowerCase().includes('closure'),
    });
  }
  console.log(`[highways] ${out.length} motorway incidents`);
  return out;
}
