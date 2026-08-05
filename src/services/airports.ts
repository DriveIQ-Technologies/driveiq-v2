/**
 * London airport hubs + their dedicated rail link statuses.
 *
 * TfL exposes Heathrow Express and Gatwick Express as full Line Status
 * entities under the National Rail mode. Stansted Express isn't a separate
 * line in the TfL API — the service runs on Greater Anglia, so we proxy its
 * status through that operator. London City and Luton don't have a dedicated
 * "express" line (DLR for City; Luton Airport Express bus + Thameslink for
 * Luton), so we surface the closest equivalent.
 *
 * No API key required. Add `EXPO_PUBLIC_TFL_APP_KEY` to bump rate limits.
 */

const APP_KEY = process.env.EXPO_PUBLIC_TFL_APP_KEY ?? '';

export interface AirportConnection {
  /** TfL line id used to query status. */
  lineId: string;
  /** Display name shown in the panel (e.g. "Heathrow Express"). */
  label: string;
  /** Footnote shown when the line is a proxy for a non-TfL service. */
  note?: string;
}

export interface Airport {
  id: string;
  name: string;
  iata: string;
  /** Used to centre the map when the user taps the airport. */
  latitude: number;
  longitude: number;
  connections: AirportConnection[];
}

export const AIRPORTS: Airport[] = [
  {
    id: 'lhr',
    name: 'Heathrow',
    iata: 'LHR',
    latitude: 51.4700,
    longitude: -0.4543,
    connections: [
      { lineId: 'heathrow-express', label: 'Heathrow Express' },
      { lineId: 'elizabeth', label: 'Elizabeth line' },
    ],
  },
  {
    id: 'lgw',
    name: 'Gatwick',
    iata: 'LGW',
    latitude: 51.1537,
    longitude: -0.1821,
    connections: [
      { lineId: 'gatwick-express', label: 'Gatwick Express' },
      { lineId: 'thameslink', label: 'Thameslink' },
    ],
  },
  {
    id: 'stn',
    name: 'Stansted',
    iata: 'STN',
    latitude: 51.8860,
    longitude: 0.2389,
    connections: [
      {
        lineId: 'greater-anglia',
        label: 'Stansted Express',
        note: 'Operated by Greater Anglia',
      },
    ],
  },
  {
    id: 'lcy',
    name: 'London City',
    iata: 'LCY',
    latitude: 51.5048,
    longitude: 0.0495,
    connections: [{ lineId: 'dlr', label: 'DLR' }],
  },
  {
    id: 'ltn',
    name: 'Luton',
    iata: 'LTN',
    latitude: 51.8763,
    longitude: -0.3717,
    connections: [
      {
        lineId: 'thameslink',
        label: 'Thameslink (via Luton Airport Parkway)',
      },
    ],
  },
];

export interface ConnectionStatus extends AirportConnection {
  statusDescription: string;
  severityBucket: 'good' | 'minor' | 'severe' | 'closed';
  reason?: string;
}

interface RawLineStatus {
  statusSeverity: number;
  statusSeverityDescription: string;
  reason?: string;
  validityPeriods?: { fromDate?: string; toDate?: string; isNow?: boolean }[];
}

interface RawLine {
  id: string;
  lineStatuses?: RawLineStatus[];
}

const bucket = (sev: number): 'good' | 'minor' | 'severe' | 'closed' => {
  if (sev >= 10) return 'good';
  if (sev <= 2) return 'closed';
  if (sev <= 6) return 'severe';
  return 'minor';
};

const isActiveNow = (
  s: RawLineStatus,
  now: number = Date.now(),
): boolean => {
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

const effectiveSeverity = (
  lineId: string,
  status: RawLineStatus | null,
): number => {
  const sev = status?.statusSeverity ?? 10;
  const desc = status?.statusSeverityDescription?.trim().toLowerCase() ?? '';
  if (lineId !== 'dlr' && lineId !== 'elizabeth' && desc === 'special service') {
    return 9;
  }
  return sev;
};

const effectiveStatusDescription = (
  lineId: string,
  status: RawLineStatus | null,
): string => {
  const desc = status?.statusSeverityDescription?.trim();
  if (lineId !== 'dlr' && lineId !== 'elizabeth' && desc === 'Special Service') {
    return 'Operator notice';
  }
  return desc || 'Good service';
};

export async function fetchAirportConnectionStatuses(): Promise<
  Record<string, ConnectionStatus[]>
> {
  // Distinct line ids across every airport — one round-trip covers them all.
  const ids = Array.from(
    new Set(AIRPORTS.flatMap((a) => a.connections.map((c) => c.lineId))),
  );

  const url = `https://api.tfl.gov.uk/Line/${ids.join(',')}/Status${
    APP_KEY ? `?app_key=${encodeURIComponent(APP_KEY)}` : ''
  }`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    console.warn('[airports] network error', e);
    return {};
  }
  if (!res.ok) {
    console.warn('[airports] non-OK', res.status);
    return {};
  }

  const raw = (await res.json()) as RawLine[];
  const byId = new Map<string, RawLineStatus>();
  for (const l of raw) {
    const worst = (l.lineStatuses ?? [])
      .filter((s) => isActiveNow(s))
      .reduce<RawLineStatus | null>(
      (acc, s) => (acc == null || s.statusSeverity < acc.statusSeverity ? s : acc),
      null,
      );
    if (worst) byId.set(l.id, worst);
  }

  const out: Record<string, ConnectionStatus[]> = {};
  for (const airport of AIRPORTS) {
    out[airport.id] = airport.connections.map((c) => {
      const s = byId.get(c.lineId);
      const sev = effectiveSeverity(c.lineId, s ?? null);
      return {
        ...c,
        statusDescription: effectiveStatusDescription(c.lineId, s ?? null),
        severityBucket: bucket(sev),
        reason: s?.reason?.trim(),
      };
    });
  }
  return out;
}
