/**
 * Google Directions API wrapper.
 *
 * Returns a sorted list of driving routes (fastest first) between two
 * lat/lng points, with decoded polylines, distance/duration metadata, and
 * per-step segments coloured by traffic level. Designed to never throw —
 * any failure resolves to `{ routes: [], error }` so the UI can render an
 * inline message instead of crashing.
 *
 * Requires `EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY` to be set. (We use a
 * separate, public-prefixed key for the Directions REST call so the JS
 * bundle can read it; the native-side `GOOGLE_MAPS_API_KEY` is for map
 * tile rendering only.)
 */

import { decodePolyline } from '@/utils/polyline';
import { formatDistanceMeters, type LatLng } from '@/utils/distance';

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY ?? '';

export type TrafficLevel = 'light' | 'moderate' | 'heavy';

export interface RouteStepSegment {
  id: string;
  coords: LatLng[];
  trafficLevel: TrafficLevel;
}

/**
 * One turn-by-turn step. Drives the navigation overlay's instruction banner
 * and is also used to advance the active step as the user moves.
 */
export interface RouteStep {
  index: number;
  /** Plain-text instruction (HTML stripped). */
  instruction: string;
  /** Maneuver code from Google: "turn-left", "turn-right", "merge", … */
  maneuver?: string;
  distanceMeters: number;
  durationSeconds: number;
  startLocation: LatLng;
  endLocation: LatLng;
  polyline: LatLng[];
}

export interface RouteOption {
  /** Stable index in the fastest-first sorted list. */
  id: number;
  /** Decoded overview polyline for the whole route. */
  polyline: LatLng[];
  /** Per-step polyline segments for traffic colouring. */
  stepSegments: RouteStepSegment[];
  /** Turn-by-turn steps used by the navigation overlay. */
  steps: RouteStep[];
  /** Metres. */
  distanceMeters: number;
  /** Free-flow seconds. */
  durationSeconds: number;
  /** Live-traffic seconds (falls back to durationSeconds when unavailable). */
  durationInTrafficSeconds: number;
  /** Google's short summary, e.g. "A40 and A4202". */
  summary: string;
  /** Overall traffic level relative to free-flow. */
  trafficLevel: TrafficLevel;
}

export interface RouteResult {
  routes: RouteOption[];
  /** User-facing error message when the request couldn't produce routes. */
  error?: string;
}

interface RawStep {
  polyline?: { points?: string };
  duration?: { value?: number };
  duration_in_traffic?: { value?: number };
  distance?: { value?: number };
  html_instructions?: string;
  maneuver?: string;
  start_location?: { lat: number; lng: number };
  end_location?: { lat: number; lng: number };
}

interface RawLeg {
  distance?: { value?: number };
  duration?: { value?: number };
  duration_in_traffic?: { value?: number };
  steps?: RawStep[];
}

interface RawRoute {
  overview_polyline?: { points?: string };
  legs?: RawLeg[];
  summary?: string;
}

interface RawDirectionsResponse {
  status?: string;
  error_message?: string;
  routes?: RawRoute[];
}

const stripHtml = (s: string | undefined): string => {
  if (!s) return '';
  // Replace <div> openings with a separator so secondary directions ("then …")
  // don't run together with the primary one.
  return s
    .replace(/<div[^>]*>/gi, ' · ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
};

const classifyTraffic = (
  base: number | undefined,
  withTraffic: number | undefined,
): TrafficLevel => {
  if (!base || !withTraffic || withTraffic <= base) return 'light';
  const pct = ((withTraffic - base) / base) * 100;
  if (pct > 50) return 'heavy';
  if (pct > 20) return 'moderate';
  return 'light';
};

const buildUrl = (
  origin: LatLng,
  destination: LatLng,
  withTraffic: boolean,
): string => {
  const o = `${origin.latitude},${origin.longitude}`;
  const d = `${destination.latitude},${destination.longitude}`;
  const params = new URLSearchParams({
    origin: o,
    destination: d,
    mode: 'driving',
    alternatives: 'true',
    key: API_KEY,
  });
  if (withTraffic) params.set('departure_time', 'now');
  return `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
};

export async function fetchRoutes(
  origin: LatLng,
  destination: LatLng,
): Promise<RouteResult> {
  if (!API_KEY) {
    return {
      routes: [],
      error:
        'Directions API key missing. Add EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY to your .env.',
    };
  }

  const sameSpot =
    Math.abs(origin.latitude - destination.latitude) < 1e-5 &&
    Math.abs(origin.longitude - destination.longitude) < 1e-5;
  if (sameSpot) {
    return { routes: [], error: 'You are already at this destination.' };
  }

  let res: Response;
  let data: RawDirectionsResponse;

  // First try with live traffic; if it errors out (e.g. billing-disabled
  // departure_time on some keys) fall back to the basic request so the
  // user still gets a route.
  try {
    res = await fetch(buildUrl(origin, destination, true));
    data = (await res.json()) as RawDirectionsResponse;
  } catch (e) {
    return { routes: [], error: 'Network error. Check your connection.' };
  }

  if (!res.ok || !data.routes?.length) {
    try {
      res = await fetch(buildUrl(origin, destination, false));
      data = (await res.json()) as RawDirectionsResponse;
    } catch (e) {
      return { routes: [], error: 'Network error. Check your connection.' };
    }
  }

  if (data.status && data.status !== 'OK') {
    const msg =
      data.error_message ||
      (data.status === 'ZERO_RESULTS'
        ? 'No driving route available between these locations.'
        : `Directions request failed (${data.status}).`);
    return { routes: [], error: msg };
  }

  if (!data.routes?.length) {
    return { routes: [], error: 'No route found.' };
  }

  const processed: RouteOption[] = data.routes.map((route, index) => {
    const leg = route.legs?.[0];
    const overviewPts = decodePolyline(route.overview_polyline?.points);
    const rawSteps = leg?.steps ?? [];

    const segs: RouteStepSegment[] = rawSteps
      .map((s, i) => ({
        id: `${index}-${i}`,
        coords: decodePolyline(s.polyline?.points),
        trafficLevel: classifyTraffic(s.duration?.value, s.duration_in_traffic?.value),
      }))
      .filter((seg) => seg.coords.length > 0);

    const steps: RouteStep[] = rawSteps.map((s, i) => ({
      index: i,
      instruction: stripHtml(s.html_instructions) || 'Continue',
      maneuver: s.maneuver,
      distanceMeters: s.distance?.value ?? 0,
      durationSeconds: s.duration?.value ?? 0,
      startLocation: s.start_location
        ? { latitude: s.start_location.lat, longitude: s.start_location.lng }
        : { latitude: 0, longitude: 0 },
      endLocation: s.end_location
        ? { latitude: s.end_location.lat, longitude: s.end_location.lng }
        : { latitude: 0, longitude: 0 },
      polyline: decodePolyline(s.polyline?.points),
    }));

    const baseDur = leg?.duration?.value ?? 0;
    const trafficDur = leg?.duration_in_traffic?.value ?? baseDur;

    return {
      id: index,
      polyline: overviewPts,
      stepSegments: segs,
      steps,
      distanceMeters: leg?.distance?.value ?? 0,
      durationSeconds: baseDur,
      durationInTrafficSeconds: trafficDur,
      summary: route.summary ?? '',
      trafficLevel: classifyTraffic(baseDur, trafficDur),
    };
  });

  // Sort fastest first (by traffic-aware duration). Reassign ids so the
  // primary route always has id=0.
  processed.sort(
    (a, b) => a.durationInTrafficSeconds - b.durationInTrafficSeconds,
  );
  processed.forEach((r, i) => {
    r.id = i;
  });

  return { routes: processed };
}

export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs} h` : `${hrs} h ${rem} min`;
};

export const formatRouteDistance = (meters: number): string => {
  return formatDistanceMeters(meters);
};

/** Maneuver code → Ionicons glyph used in the instruction banner. */
export const maneuverIcon = (
  maneuver: string | undefined,
): 'arrow-up' | 'arrow-back' | 'arrow-forward' | 'return-up-back' | 'flag' | 'git-branch' => {
  if (!maneuver) return 'arrow-up';
  if (maneuver.startsWith('uturn')) return 'return-up-back';
  if (maneuver.includes('left')) return 'arrow-back';
  if (maneuver.includes('right')) return 'arrow-forward';
  if (maneuver === 'fork' || maneuver === 'ramp' || maneuver === 'merge') return 'git-branch';
  return 'arrow-up';
};

export const formatEta = (seconds: number): string => {
  const eta = new Date(Date.now() + Math.max(0, seconds) * 1000);
  return eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export const trafficColor = (level: TrafficLevel): string => {
  switch (level) {
    case 'heavy':
      return '#EA4335';
    case 'moderate':
      return '#FBBC04';
    default:
      return '#4285F4';
  }
};
