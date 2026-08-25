/**
 * AeroDataBox (via RapidAPI) — airport arrivals / departures boards.
 *
 * Powers the airport flight pins (LHR / LGW / LTN / STN / LCY). One call per
 * airport returns both directions for a time window (max 12h per AeroDataBox).
 *
 * Docs: https://rapidapi.com/aedbx-aedbx/api/aerodatabox
 * Endpoint: /flights/airports/icao/{icao}/{fromLocal}/{toLocal}
 *
 * The HTTP layer (`fetchAirportFlights`) is thin; all the brittle parsing is in
 * the pure `normalizeFids` function so it can be unit-tested without a network
 * or API key (see scripts/test-aerodatabox.ts).
 */

const API_KEY = process.env.EXPO_PUBLIC_AERODATABOX_API_KEY ?? '';
const HOST = 'aerodatabox.p.rapidapi.com';
const BASE = `https://${HOST}`;

/** Airport id (matches AIRPORTS in airports.ts) → ICAO code AeroDataBox uses. */
export const AIRPORT_ICAO: Record<string, string> = {
  lhr: 'EGLL',
  lgw: 'EGKK',
  stn: 'EGSS',
  lcy: 'EGLC',
  ltn: 'EGGW',
};

export type FlightDirection = 'arrival' | 'departure';

/** Normalised flight row used by the UI. */
export interface AirportFlight {
  id: string;
  direction: FlightDirection;
  /** e.g. "BA 831". */
  flightNumber: string;
  /** e.g. "British Airways". */
  airline: string;
  /** Origin (arrivals) or destination (departures) airport name. */
  counterpart: string;
  counterpartIata?: string;
  /** Raw local time strings from AeroDataBox (kept for display). */
  scheduledLocal?: string;
  revisedLocal?: string;
  /** Scheduled time as ms epoch (from the UTC field) for sorting. */
  scheduledMs: number;
  status: string;
  cancelled: boolean;
  delayed: boolean;
  /** Positive = minutes late; only set when a revised time is present. */
  delayMinutes?: number;
  terminal?: string;
}

// ── Raw AeroDataBox shapes (only the fields we read) ────────────────────────
interface AdbTime {
  utc?: string;
  local?: string;
}
interface AdbAirportRef {
  icao?: string;
  iata?: string;
  name?: string;
  shortName?: string;
}
interface AdbMovement {
  airport?: AdbAirportRef;
  scheduledTime?: AdbTime;
  revisedTime?: AdbTime;
  terminal?: string;
}
interface AdbFlight {
  number?: string;
  status?: string;
  airline?: { name?: string };
  movement?: AdbMovement;
  isCargo?: boolean;
}
export interface AdbFidsResponse {
  departures?: AdbFlight[];
  arrivals?: AdbFlight[];
}

/** AeroDataBox UTC times look like "2026-06-26 07:05Z" — make them ISO-parseable. */
function parseAdbUtc(s?: string): number {
  if (!s) return NaN;
  // "2026-06-26 07:05Z" → "2026-06-26T07:05Z"
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return new Date(iso).getTime();
}

const isCancelledStatus = (status?: string): boolean =>
  /cancel/i.test(status ?? '');

/** Threshold (minutes) at which a flight is flagged as delayed. */
const DELAY_THRESHOLD_MIN = 15;

function normalizeOne(
  f: AdbFlight,
  direction: FlightDirection,
  index: number,
): AirportFlight {
  const m = f.movement ?? {};
  const schedMs = parseAdbUtc(m.scheduledTime?.utc);
  const revMs = parseAdbUtc(m.revisedTime?.utc);
  const cancelled = isCancelledStatus(f.status);

  let delayMinutes: number | undefined;
  if (Number.isFinite(schedMs) && Number.isFinite(revMs)) {
    delayMinutes = Math.round((revMs - schedMs) / 60000);
  }
  const delayed =
    !cancelled &&
    ((delayMinutes != null && delayMinutes >= DELAY_THRESHOLD_MIN) ||
      /delay/i.test(f.status ?? ''));

  const airport = m.airport ?? {};
  const flightNumber = (f.number ?? '').trim() || 'Flight';

  return {
    id: `adb-${direction}-${flightNumber}-${m.scheduledTime?.utc ?? index}`,
    direction,
    flightNumber,
    airline: (f.airline?.name ?? '').trim(),
    counterpart: airport.name ?? airport.shortName ?? airport.iata ?? 'Unknown',
    counterpartIata: airport.iata,
    scheduledLocal: m.scheduledTime?.local,
    revisedLocal: m.revisedTime?.local,
    scheduledMs: Number.isFinite(schedMs) ? schedMs : 0,
    status: (f.status ?? '').trim() || 'Scheduled',
    cancelled,
    delayed,
    delayMinutes,
    terminal: m.terminal?.trim() || undefined,
  };
}

/**
 * Pure transform: AeroDataBox FIDS payload → sorted, normalised flight rows.
 * No network, no env — safe to unit-test. Cargo flights are dropped.
 */
export function normalizeFids(raw: AdbFidsResponse): AirportFlight[] {
  const out: AirportFlight[] = [];
  (raw.arrivals ?? []).forEach((f, i) => {
    if (f.isCargo) return;
    out.push(normalizeOne(f, 'arrival', i));
  });
  (raw.departures ?? []).forEach((f, i) => {
    if (f.isCargo) return;
    out.push(normalizeOne(f, 'departure', i));
  });
  return out.sort((a, b) => a.scheduledMs - b.scheduledMs);
}

/** Pad a number to 2 digits. */
const p2 = (n: number) => String(n).padStart(2, '0');

/** AeroDataBox wants local datetime as "YYYY-MM-DDTHH:mm". */
function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(
    d.getHours(),
  )}:${p2(d.getMinutes())}`;
}

export interface AirportFlightsResult {
  flights: AirportFlight[];
  error?: 'no-key' | 'rate-limited' | 'network' | 'http';
  /** HTTP status when error === 'http', for precise diagnostics. */
  status?: number;
}

/**
 * Fetch arrivals + departures for one airport.
 *
 * Default window: ~1h back → 10h ahead (free / standard board).
 * `fullDay: true` (Premium): two chunked calls covering local midnight → midnight
 * (AeroDataBox caps each request at 12h).
 */
export async function fetchAirportFlights(
  airportId: string,
  now: Date = new Date(),
  opts: { fullDay?: boolean } = {},
): Promise<AirportFlightsResult> {
  if (!opts.fullDay) {
    const { readAirportCache } = await import('./airportCache');
    const cached = await readAirportCache(airportId);
    if (cached?.flights?.length) {
      return { flights: cached.flights };
    }
  }

  if (!API_KEY) {
    console.warn('[aerodatabox] EXPO_PUBLIC_AERODATABOX_API_KEY not set — skipping');
    return { flights: [], error: 'no-key' };
  }
  const icao = AIRPORT_ICAO[airportId];
  if (!icao) {
    console.warn('[aerodatabox] no ICAO mapping for', airportId);
    return { flights: [], error: 'http' };
  }

  const windows: { from: Date; to: Date }[] = [];
  if (opts.fullDay) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const mid = new Date(start);
    mid.setHours(12, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    windows.push({ from: start, to: mid }, { from: mid, to: end });
  } else {
    windows.push({
      from: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      to: new Date(now.getTime() + 10 * 60 * 60 * 1000),
    });
  }

  const byId = new Map<string, AirportFlight>();
  let lastError: AirportFlightsResult['error'];
  let lastStatus: number | undefined;

  for (const w of windows) {
    const chunk = await fetchAirportFlightsWindow(icao, w.from, w.to);
    if (chunk.error) {
      lastError = chunk.error;
      lastStatus = chunk.status;
      continue;
    }
    for (const f of chunk.flights) byId.set(f.id, f);
  }

  const flights = Array.from(byId.values()).sort(
    (a, b) => a.scheduledMs - b.scheduledMs,
  );

  if (flights.length === 0 && lastError) {
    return { flights: [], error: lastError, status: lastStatus };
  }

  console.log(
    `[aerodatabox] ${icao}: ${flights.length} flights ` +
      `(${flights.filter((f) => f.direction === 'arrival').length} arr, ` +
      `${flights.filter((f) => f.direction === 'departure').length} dep, ` +
      `${flights.filter((f) => f.delayed).length} delayed, ` +
      `${flights.filter((f) => f.cancelled).length} cancelled` +
      `${opts.fullDay ? ', full-day' : ''})`,
  );
  return { flights };
}

async function fetchAirportFlightsWindow(
  icao: string,
  from: Date,
  to: Date,
): Promise<AirportFlightsResult> {
  const params = new URLSearchParams({
    direction: 'Both',
    withLeg: 'false',
    withCancelled: 'true',
    withCodeshared: 'false',
    withCargo: 'false',
    withPrivate: 'false',
    withLocation: 'false',
  });
  const url = `${BASE}/flights/airports/icao/${icao}/${formatLocal(
    from,
  )}/${formatLocal(to)}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': HOST,
      },
    });
  } catch (e) {
    console.warn('[aerodatabox] network error', e);
    return { flights: [], error: 'network' };
  }

  if (res.status === 429) {
    console.warn('[aerodatabox] rate limited (429)');
    return { flights: [], error: 'rate-limited' };
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      body = '(no body)';
    }
    console.warn(`[aerodatabox] non-OK ${res.status} for ${icao}: ${body}`);
    return { flights: [], error: 'http', status: res.status };
  }

  const json = (await res.json()) as AdbFidsResponse;
  return { flights: normalizeFids(json) };
}
