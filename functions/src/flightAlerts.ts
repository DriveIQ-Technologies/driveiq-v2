/**
 * What to tell someone watching a flight, from one board check to the next.
 *
 * One alert per flight per check, most important first: cancelled, then
 * landed / departed, then delayed (or later again), then running earlier.
 * The wording is built from the live board every time — never from stored
 * copy, which would go stale between checks.
 */
import type { CachedFlight } from './airports.js';

/** A watched flight as the app saved it, plus what the server has seen since. */
export interface WatchedFlightState {
  id: string;
  airportId: string;
  flightNumber: string;
  cancelled?: boolean;
  delayed?: boolean;
  delayMinutes?: number;
  /** Board status at the last check ("Expected", "Arrived", "Departed", …). */
  status?: string;
  /**
   * The delay the user was last told about. "Later again by 15 minutes" is
   * measured from this, not from the previous check, or a flight slipping 10
   * minutes per check (25 → 35 → 45 → …) never alerted again.
   */
  alertedDelayMinutes?: number;
  /** The time (ms) the user was last told to expect; "earlier" is measured from it. */
  announcedMs?: number;
}

export type FlightAlertKind = 'cancelled' | 'landed' | 'departed' | 'delayed' | 'earlier';

export interface FlightAlert {
  kind: FlightAlertKind;
  title: string;
  body: string;
}

const MIN = 60 * 1000;
/** Same threshold both ways: 15 minutes later or earlier is worth a ping. */
const CHANGE_MS = 15 * MIN;

export function londonHhmm(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function expectedMs(f: CachedFlight): number {
  return f.revisedMs ?? f.scheduledMs;
}

function isDone(f: CachedFlight): boolean {
  return f.direction === 'arrival' ? f.status === 'Arrived' : f.status === 'Departed';
}

function terminalText(f: CachedFlight): string {
  const t = (f.terminal ?? '').trim();
  return t ? ` · Terminal ${t}` : '';
}

/**
 * @param saved  the flight as saved in the app (users/{uid}.savedFlights)
 * @param state  what the server recorded at the previous check, if any
 * @param live   the flight on the current board
 */
export function evaluateWatchedFlight(
  saved: WatchedFlightState,
  state: WatchedFlightState | undefined,
  live: CachedFlight,
): { alert: FlightAlert | null; next: WatchedFlightState } {
  const before = state ?? saved;
  // Landed / departed / earlier need a previous check to compare against: on
  // first sight we only record, so watching a flight that has already landed
  // doesn't announce it as news.
  const seenBefore = state != null;
  const fn = live.flightNumber;
  const now = expectedMs(live);
  const announced = state?.announcedMs ?? now;
  const announcedDelay = before.alertedDelayMinutes ?? before.delayMinutes ?? 0;
  const done = isDone(live);

  let alert: FlightAlert | null = null;

  if (!before.cancelled && live.cancelled) {
    alert = {
      kind: 'cancelled',
      title: `${fn} cancelled`,
      body: `${fn} ${live.direction === 'arrival' ? 'from' : 'to'} ${live.counterpart} is cancelled.`,
    };
  } else if (seenBefore && done && state.status !== live.status) {
    alert =
      live.direction === 'arrival'
        ? {
            kind: 'landed',
            title: `${fn} has landed`,
            body: `From ${live.counterpart}, landed ${londonHhmm(now)}${terminalText(live)}.`,
          }
        : {
            kind: 'departed',
            title: `${fn} has departed`,
            body: `To ${live.counterpart}, left ${londonHhmm(now)}.`,
          };
  } else if (!done && !live.cancelled) {
    const becameDelayed = !before.delayed && live.delayed;
    const laterAgain =
      Boolean(before.delayed) && live.delayed && (live.delayMinutes ?? 0) >= announcedDelay + 15;
    if (becameDelayed || laterAgain) {
      alert = {
        kind: 'delayed',
        title: `${fn} delayed`,
        body: `${fn} is now delayed by ${live.delayMinutes ?? 0}m, due ${londonHhmm(now)}${
          live.direction === 'arrival' ? terminalText(live) : ''
        }.`,
      };
    } else if (seenBefore && now <= announced - CHANGE_MS) {
      alert = {
        kind: 'earlier',
        title: `${fn} ${live.direction === 'arrival' ? 'arriving' : 'leaving'} earlier`,
        body: `Now due ${londonHhmm(now)}, was ${londonHhmm(announced)}${
          live.direction === 'arrival' ? terminalText(live) : ''
        }.`,
      };
    }
  }

  // Delay last announced: updated when we tell them, kept while still late,
  // forgotten once on time so a new delay starts fresh.
  const nextAlertedDelay =
    alert?.kind === 'delayed'
      ? (live.delayMinutes ?? 0)
      : live.delayed
        ? (state?.alertedDelayMinutes ?? state?.delayMinutes ?? saved.delayMinutes)
        : undefined;
  // Time last announced: moves when we tell them a new time.
  const nextAnnounced =
    alert?.kind === 'delayed' || alert?.kind === 'earlier' ? now : (state?.announcedMs ?? now);

  const next: WatchedFlightState = {
    id: live.id,
    airportId: saved.airportId,
    flightNumber: live.flightNumber,
    cancelled: live.cancelled,
    delayed: live.delayed,
    status: live.status,
    announcedMs: nextAnnounced,
    ...(live.delayMinutes != null ? { delayMinutes: live.delayMinutes } : {}),
    ...(nextAlertedDelay != null ? { alertedDelayMinutes: nextAlertedDelay } : {}),
  };
  return { alert, next };
}
