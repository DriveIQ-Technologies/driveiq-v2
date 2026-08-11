/**
 * Major London termini — station-first rail hubs.
 *
 * Connections today is operator-wide (TfL / National Rail line status). Premium
 * waitlist feedback asked for station hubs: tap Paddington / Waterloo / etc. and
 * see every tube, Elizabeth, Overground and National Rail service that serves
 * that terminus, with live status — not a copy of nationalrail.co.uk's TOC list.
 *
 * Line ids are TfL Discovery API ids. Destinations are curated blurbs so the
 * sheet explains *where* each hub connects (UK regions / airports), which the
 * raw operator feed never surfaces.
 */

import {
  fetchLineStatusesByIds,
  type LineStatus,
} from '@/services/tflLines';

export interface StationLine {
  /** TfL line id (e.g. "elizabeth", "south-western-railway"). */
  lineId: string;
  /** Optional override label when TfL's name is too generic. */
  label?: string;
}

export interface MajorStation {
  id: string;
  name: string;
  /** Short "serves…" line for the hub list. */
  serves: string;
  latitude: number;
  longitude: number;
  /** NaPTAN / CRS hint for future arrival boards (not required for status). */
  crs?: string;
  lines: StationLine[];
}

/**
 * Seven termini that link London to the rest of the UK / Continent.
 * More hubs can be added later without changing the UI pattern.
 */
export const MAJOR_STATIONS: MajorStation[] = [
  {
    id: 'paddington',
    name: 'London Paddington',
    serves: 'West England, South Wales & Heathrow',
    latitude: 51.5154,
    longitude: -0.1755,
    crs: 'PAD',
    lines: [
      { lineId: 'great-western-railway', label: 'Great Western Railway' },
      { lineId: 'elizabeth', label: 'Elizabeth line' },
      { lineId: 'heathrow-express', label: 'Heathrow Express' },
      { lineId: 'bakerloo' },
      { lineId: 'circle' },
      { lineId: 'district' },
      { lineId: 'hammersmith-city', label: 'Hammersmith & City' },
    ],
  },
  {
    id: 'euston',
    name: 'London Euston',
    serves: 'West Midlands, North West & Scotland',
    latitude: 51.5282,
    longitude: -0.1337,
    crs: 'EUS',
    lines: [
      { lineId: 'avanti-west-coast', label: 'Avanti West Coast' },
      { lineId: 'london-northwestern-railway', label: 'London Northwestern' },
      { lineId: 'london-overground', label: 'Overground' },
      { lineId: 'northern' },
      { lineId: 'victoria' },
    ],
  },
  {
    id: 'kings-cross',
    name: "London King's Cross",
    serves: 'York, Newcastle & Edinburgh (East Coast)',
    latitude: 51.5308,
    longitude: -0.1238,
    crs: 'KGX',
    lines: [
      { lineId: 'great-northern', label: 'Great Northern / Thameslink core' },
      { lineId: 'thameslink' },
      { lineId: 'northern' },
      { lineId: 'piccadilly' },
      { lineId: 'victoria' },
      { lineId: 'circle' },
      { lineId: 'hammersmith-city', label: 'Hammersmith & City' },
      { lineId: 'metropolitan' },
    ],
  },
  {
    id: 'st-pancras',
    name: 'London St Pancras International',
    serves: 'Eurostar, East Midlands & Thameslink',
    latitude: 51.5314,
    longitude: -0.1261,
    crs: 'STP',
    lines: [
      { lineId: 'east-midlands-railway', label: 'East Midlands Railway' },
      { lineId: 'thameslink' },
      { lineId: 'northern' },
      { lineId: 'piccadilly' },
      { lineId: 'victoria' },
      { lineId: 'circle' },
      { lineId: 'hammersmith-city', label: 'Hammersmith & City' },
      { lineId: 'metropolitan' },
    ],
  },
  {
    id: 'waterloo',
    name: 'London Waterloo',
    serves: 'South-west London, Surrey & the South Coast',
    latitude: 51.5031,
    longitude: -0.1132,
    crs: 'WAT',
    lines: [
      { lineId: 'south-western-railway', label: 'South Western Railway' },
      { lineId: 'bakerloo' },
      { lineId: 'northern' },
      { lineId: 'jubilee' },
      { lineId: 'waterloo-city', label: 'Waterloo & City' },
    ],
  },
  {
    id: 'liverpool-street',
    name: 'London Liverpool Street',
    serves: 'Essex, East Anglia & Stansted Airport',
    latitude: 51.5178,
    longitude: -0.0817,
    crs: 'LST',
    lines: [
      { lineId: 'greater-anglia', label: 'Greater Anglia' },
      { lineId: 'elizabeth', label: 'Elizabeth line' },
      { lineId: 'c2c', label: 'c2c' },
      { lineId: 'london-overground', label: 'Overground' },
      { lineId: 'central' },
      { lineId: 'circle' },
      { lineId: 'hammersmith-city', label: 'Hammersmith & City' },
      { lineId: 'metropolitan' },
    ],
  },
  {
    id: 'victoria',
    name: 'London Victoria',
    serves: 'Gatwick, Sussex & parts of Kent',
    latitude: 51.4952,
    longitude: -0.1441,
    crs: 'VIC',
    lines: [
      { lineId: 'southern', label: 'Southern' },
      { lineId: 'southeastern', label: 'Southeastern' },
      { lineId: 'gatwick-express', label: 'Gatwick Express' },
      { lineId: 'victoria' },
      { lineId: 'district' },
      { lineId: 'circle' },
    ],
  },
];

export interface StationLineStatus extends LineStatus {
  /** Display label (curated override or TfL name). */
  displayName: string;
}

/**
 * Live statuses for every line serving a hub. Unknown / missing TfL ids are
 * dropped (e.g. Eurostar isn't always exposed as a Line Status entity).
 */
export async function fetchStationLineStatuses(
  station: MajorStation,
): Promise<StationLineStatus[]> {
  const ids = station.lines.map((l) => l.lineId);
  const labelById = new Map(
    station.lines.map((l) => [l.lineId, l.label] as const),
  );
  const statuses = await fetchLineStatusesByIds(ids);
  const byId = new Map(statuses.map((s) => [s.id, s]));

  const out: StationLineStatus[] = [];
  for (const ref of station.lines) {
    const s = byId.get(ref.lineId);
    if (!s) continue;
    out.push({
      ...s,
      displayName: ref.label ?? s.name,
    });
  }
  return out;
}
