/**
 * Unified event shape used throughout the UI.
 * Both SportMonks fixtures and Ticketmaster events are normalised to this.
 */
export type EventCategory = 'sports' | 'other';

export interface AppEvent {
  /** Globally-unique id, prefixed with the source for safety. */
  id: string;
  /** Provider name. `featured` = a hand-curated big event that isn't in any
   *  API feed (e.g. Royal Ascot, Epsom Derby). */
  source:
    | 'thesportsdb'
    | 'football-data'
    | 'espn'
    | 'fotmob'
    | 'ticketmaster'
    | 'venue-site'
    | 'sample'
    | 'featured';
  category: EventCategory;
  title: string;
  /** ISO-8601 start time. */
  startsAt: string;
  /** ISO-8601 end time. Always populated — providers that don't return an
   *  explicit end time fall back to a sensible default duration based on
   *  the sport/category (e.g. 2h for football, 8h for cricket Test). */
  endsAt: string;
  /** Human-readable venue name. */
  venue: string;
  /** Map coordinates. */
  latitude: number;
  longitude: number;
  /** Optional short description / summary. */
  description?: string;
  /** Sub-classification: e.g. "Football", "Music", "Theatre". */
  subCategory?: string;
  /** External URL (used internally — not rendered as a Get Tickets button per requirements). */
  url?: string;
  /** Doors time (ISO). Task 08: when people start arriving, not on-sale. */
  doorsAt?: string;
  /** Real start (ISO). Kick-off or headline, not doors. */
  realStartAt?: string;
  /** Estimated finish (ISO). When the crowd walks out. */
  estimatedFinishAt?: string;
  /** Expected turnout low end. Always a range, never a precise headcount. */
  turnoutMin?: number;
  /** Expected turnout high end. */
  turnoutMax?: number;
  /** One-line driver description from the nightly job or the local fallback. */
  copyLine?: string;
}
