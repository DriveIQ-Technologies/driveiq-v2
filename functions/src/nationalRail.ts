/**
 * National Rail service status, from the Knowledgebase National Service
 * Indicator (NSI) feed on the Rail Data Marketplace.
 *
 * Why this exists: TfL's `national-rail` mode parks eight operators on a
 * permanent "Special Service" at severity 0 whose entire payload is a link to a
 * months-old page. It carries no live severity, so South Western Railway could
 * be in serious disruption while the app showed nothing useful. NSI gives a
 * real per-operator status, refreshed continuously.
 *
 * Auth is a plain `x-apikey` header holding the RDM consumer key — no OAuth
 * exchange, and the consumer secret is not used.
 *
 * Schema note: the NSI spec's own tag table says <Code>/<Name> while its sample
 * XML uses <TocCode>/<TocName>. Both are accepted below rather than betting on
 * which one the live feed emits. There is no XSD for this feed (the spec says
 * so outright), so everything here is defensive.
 */

import { XMLParser } from 'fast-xml-parser';
import { logger } from 'firebase-functions';

/**
 * Rail Data Marketplace endpoint for the NSI feed.
 * Their path really does spell it "knowlegebase" — do not correct it.
 */
export const NSI_FEED_URL =
  'https://api1.raildata.org.uk/1010-knowlegebase-national-service-indicator-xml-feed2_0/4.0/serviceindicators.xml';

/** Matches the app's LineSeverityBucket exactly. */
export type RailSeverity = 'good' | 'minor' | 'severe' | 'closed';

export interface RailOperatorStatus {
  /** Two-character TOC code, e.g. "SW". */
  code: string;
  name: string;
  /** Human status, resolved. See resolveStatusText for why this is not <Status>. */
  status: string;
  severity: RailSeverity;
  /** How many service groups currently carry a disruption. */
  disruptionCount: number;
  /** Named routes/areas, when the feed supplies them (it often does not). */
  disruptedGroups: string[];
  url?: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  // CDATA blocks (CustomDetail, AdditionalInfo) become plain text.
  cdataPropName: false as unknown as string,
  parseTagValue: false,
});

const text = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';

/** Always an array, whether the feed gave one element or many. */
const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/**
 * Map the feed's free-text status onto a severity bucket.
 *
 * `Status` is prose, not an enum — the spec defines no permitted values — so
 * this matches on phrases, worst first. Anything unrecognised falls to 'minor':
 * the operator is saying SOMETHING, so it belongs on the board, but we will not
 * claim a severity we cannot justify. Falling back to 'good' would hide real
 * disruption, which is the exact failure this replaces.
 */
/**
 * Pick the text that actually describes the service.
 *
 * Live feed behaviour the spec does not mention: <Status> is a small enum in
 * practice — "Good service" for 25 of 31 operators, and the literal string
 * "Custom" for the rest. "Custom" is a pointer, not a status: the real wording
 * lives in <StatusDescription> (e.g. "An amended timetable is in operation").
 * Reading <Status> alone would collapse every disrupted operator to one
 * meaningless value.
 */
export function resolveStatusText(status: string, description: string): string {
  if (!status || /^custom$/i.test(status.trim())) return description || status;
  return status;
}

export function severityFromStatus(status: string): RailSeverity {
  const s = status.toLowerCase().trim();
  // Nothing said at all is the one case we can safely read as normal service.
  if (!s) return 'good';

  // Ordered worst-first. Patterns are taken from what the live feed actually
  // says, not from the spec — it defines no permitted values.
  if (/suspend|line closed|closed all day|not running|cancelled all/.test(s)) {
    return 'closed';
  }
  // "No trains between X and Y" is a real severe case the feed states plainly.
  // Checked before the 'minor' rules so "no direct service" cannot swallow it.
  if (/major|severe|significant|serious|no trains|no service between/.test(s)) {
    return 'severe';
  }
  if (
    /no direct|minor|some delays|delays on some|busier|revised|amended|reduced|temporary|changes to|disrupt/.test(
      s,
    )
  ) {
    return 'minor';
  }
  if (/good service|normal service|running normally|no reported/.test(s)) return 'good';
  return 'minor';
}

/**
 * The link for the disruption the status is actually about.
 *
 * An operator can carry several disruptions at once, and the feed lists them
 * oldest first. Taking the first link meant South Western's "Major disruption
 * in the Twickenham area" linked to an engineering notice from March
 * (overton-20260327) while today's was last in the list
 * (twickenham-area-20260924). National Rail's URLs end in the date the
 * disruption started, so take the newest; fall back to the last one listed.
 */
export function newestDisruptionUrl(urls: string[]): string | undefined {
  const real = urls.filter(Boolean);
  if (real.length === 0) return undefined;
  const dated = real
    .map((u, i) => ({ u, i, d: (u.match(/-(\d{8})\/?$/) ?? [])[1] ?? '' }))
    .filter((x) => x.d);
  if (dated.length > 0) {
    // Newest date wins; on a tie, the one listed later.
    dated.sort((a, b) => (a.d === b.d ? b.i - a.i : b.d.localeCompare(a.d)));
    return dated[0].u;
  }
  return real[real.length - 1];
}

/** Parse an NSI XML document into per-operator statuses. */
export function parseServiceIndicators(xml: string): RailOperatorStatus[] {
  if (!xml || !xml.trim()) return [];
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    logger.warn('rail.nsi_parse_fail', {
      message: e instanceof Error ? e.message : 'error',
    });
    return [];
  }

  const nsi = (doc.NSI ?? {}) as Record<string, unknown>;
  const tocs = asArray(nsi.TOC as Record<string, unknown> | Record<string, unknown>[]);

  const out: RailOperatorStatus[] = [];
  for (const toc of tocs) {
    // Spec table says Code/Name; the spec's own sample says TocCode/TocName.
    const code = text(toc.TocCode ?? toc.Code).toUpperCase();
    const name = text(toc.TocName ?? toc.Name);
    if (!code && !name) continue;

    const status = resolveStatusText(text(toc.Status), text(toc.StatusDescription));
    const groups = asArray(
      toc.ServiceGroup as Record<string, unknown> | Record<string, unknown>[],
    );
    // Only groups carrying a disruption id are actually disrupted. <GroupName>
    // is in the spec but absent from every entry in the live feed, so the name
    // list is best-effort and the count is what callers should rely on.
    const disrupted = groups.filter((g) => text(g.CurrentDisruption));
    const disruptedGroups = disrupted.map((g) => text(g.GroupName)).filter(Boolean);

    const url = newestDisruptionUrl(
      (disrupted.length > 0 ? disrupted : groups).map((g) => text(g.CustomUrl ?? g.CustomURL)),
    );

    out.push({
      code,
      name: name || code,
      status,
      severity: severityFromStatus(status),
      disruptionCount: disrupted.length,
      disruptedGroups,
      // Omitted rather than undefined: Firestore rejects undefined values.
      ...(url ? { url } : {}),
    });
  }
  return out;
}

/** Fetch and parse the NSI feed. Returns null when the REQUEST failed. */
export async function fetchServiceIndicators(opts: {
  apiKey: string;
  url: string;
}): Promise<RailOperatorStatus[] | null> {
  let res: Response;
  try {
    res = await fetch(opts.url, {
      headers: { 'x-apikey': opts.apiKey, accept: 'application/xml' },
    });
  } catch (e) {
    logger.warn('rail.nsi_network_fail', {
      message: e instanceof Error ? e.message : 'error',
    });
    return null;
  }
  if (!res.ok) {
    // 401/403 here means the consumer key is wrong, or the secret was sent
    // instead of the key — the single most common setup mistake on RDM.
    logger.warn('rail.nsi_http', { status: res.status });
    return null;
  }
  return parseServiceIndicators(await res.text());
}

/**
 * NSI TOC code → the line id the app already uses (TfL's national-rail ids).
 *
 * Only operators that serve London are mapped; the rest are still cached, keyed
 * by a lowercased TOC code, so station hubs for termini can find them.
 *
 * Elizabeth line (XR) and London Overground (LO) appear in NSI but are
 * deliberately absent here: TfL reports those two properly and in more detail,
 * so they stay on the TfL path.
 */
export const TOC_TO_LINE_ID: Record<string, string> = {
  CC: 'c2c',
  CH: 'chiltern-railways',
  EM: 'east-midlands-railway',
  GX: 'gatwick-express',
  GN: 'great-northern',
  GW: 'great-western-railway',
  LE: 'greater-anglia',
  HX: 'heathrow-express',
  SN: 'southern',
  SW: 'south-western-railway',
  SE: 'southeastern',
  SX: 'stansted-express',
  TL: 'thameslink',
  VT: 'avanti-west-coast',
  XC: 'cross-country',
  GR: 'lner',
};

/** Operators TfL already covers better — excluded so the two never disagree. */
const TFL_OWNED_TOCS = new Set(['XR', 'LO']);

export function lineIdForToc(code: string): string {
  return TOC_TO_LINE_ID[code.toUpperCase()] ?? code.toLowerCase();
}

export interface RailCacheDoc {
  operators: Array<RailOperatorStatus & { lineId: string }>;
  updatedAt: string;
  updatedAtMs: number;
}

/**
 * Fetch NSI and publish it to `railCache/national` for the app to read.
 *
 * Same contract as the airport caches: one poll serves every user, the API key
 * never leaves the server, and a failed fetch leaves the previous good document
 * in place rather than publishing an empty board.
 */
export async function ingestNationalRail(opts: {
  db: FirebaseFirestore.Firestore;
  apiKey: string | undefined;
  url: string;
}): Promise<number> {
  if (!opts.apiKey?.trim()) {
    logger.warn('rail.no_key');
    return 0;
  }
  const rows = await fetchServiceIndicators({ apiKey: opts.apiKey, url: opts.url });
  if (rows === null) {
    // Request failed — keep the last good statuses rather than blanking rail.
    logger.warn('rail.fetch_failed_keeping_cache');
    return 0;
  }
  if (rows.length === 0) {
    logger.warn('rail.empty_feed_keeping_cache');
    return 0;
  }

  const operators = rows
    .filter((r) => !TFL_OWNED_TOCS.has(r.code))
    .map((r) => ({ ...r, lineId: lineIdForToc(r.code) }));

  await opts.db.doc('railCache/national').set(
    {
      operators,
      updatedAt: new Date().toISOString(),
      updatedAtMs: Date.now(),
    },
    { merge: true },
  );
  logger.info('rail.published', {
    operators: operators.length,
    disrupted: operators.filter((o) => o.severity !== 'good').length,
  });
  return operators.length;
}
