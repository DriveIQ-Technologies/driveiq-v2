/**
 * Default event duration by sub-category, used to compute an `endsAt` when
 * the upstream provider only returns a start time (which is most of them).
 *
 * Values are minutes from start. Chosen to match how the event actually
 * occupies the user's evening — a Cricket Test "ends" at end of play not
 * end of match, a Premier League match includes typical half-time + added
 * time, theatre includes interval + curtain.
 */
const DEFAULT_DURATION_MINUTES: Record<string, number> = {
  // ── Sports ───────────────────────────────────────
  Football: 120,            // 90' + 15' HT + injury time
  Rugby: 120,               // 80' + 15' HT + stoppages
  Cricket: 480,             // Test = full day's play (~10:30→18:30)
  'Cricket T20': 240,       // ~3.5h game + travel/parking buffer
  'Cricket ODI': 420,       // ~7h game
  'Cricket Test': 480,
  Tennis: 180,              // Best-of-3 average
  Basketball: 150,          // 48 game-mins + breaks
  'American Football': 210, // 3.5h average NFL game
  Boxing: 240,              // undercard + main event
  MMA: 240,                 // multiple fights on a card
  Hockey: 180,
  Motorsport: 120,
  Darts: 180,
  Golf: 480,                // a day's tournament play
  'Horse Racing': 360,      // gates → last race, ~6h (e.g. 12:00–18:00)
  Wrestling: 240,           // WWE-style card
  eSports: 240,
  Running: 300,             // marathon / mass-participation race
  Equestrian: 360,

  // ── Non-sports (Ticketmaster) ────────────────────
  Music: 180,               // concert + opener
  Concert: 180,
  Theatre: 180,             // 2h show + interval + curtain
  Arts: 180,
  Comedy: 150,
  Film: 150,
  Family: 120,
  Other: 180,
  Sports: 180,
};

/**
 * True if `key` has a known default duration. Providers whose sub-category
 * is a free-form genre (Ticketmaster: "Rock", "Musical"…) use this to fall
 * back to a segment-level key instead of silently getting 120 minutes.
 */
export function hasDefaultDuration(key: string | undefined): boolean {
  return key != null && DEFAULT_DURATION_MINUTES[key] != null;
}

/**
 * Add `minutes` to an ISO timestamp and return a new ISO string.
 * Robust to either Z-suffixed or offset-style ISO inputs.
 */
export function addMinutesIso(iso: string, minutes: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  return new Date(t + minutes * 60_000).toISOString();
}

/**
 * Compute a default `endsAt` for an event whose provider only gave us a
 * start time. Looks up the duration by sub-category, falling back to 2h
 * if the sub-category isn't recognised.
 */
export function defaultEndsAt(
  startsAt: string,
  subCategory: string | undefined,
): string {
  const minutes =
    (subCategory ? DEFAULT_DURATION_MINUTES[subCategory] : undefined) ?? 120;
  return addMinutesIso(startsAt, minutes);
}
