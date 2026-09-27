/**
 * Cheap question classifier so we only send the model the live data it
 * needs. The prompt already says "travel questions must not mention events",
 * but we were still paying to encode 80 event rows on every tube/traffic ask.
 *
 * The phone already drops events on travel-only questions. The server used to
 * treat that empty list as "map sent nothing" and backfill Firestore events —
 * which put the tokens right back in.
 */

export type AgentIntent = 'travel' | 'events' | 'mixed';

const TRAVEL_RE =
  /\b(train|trains|tube|rail|tfl|travel|traffic|road|roads|delay|delays|flight|flights|airport|heathrow|gatwick|stansted|luton|city airport|lhr|lgw|stn|ltn|lcy|congestion|disruption|signal failure|line status|m25|a406|blackwall|rotherhithe)\b/i;

const EVENTS_RE =
  /\b(event|events|tonight|today|tomorrow|weekend|concert|gig|match|matches|game|fixture|what's on|whats on|what is on|going on|wembley|o2|arsenal|chelsea|tottenham|spurs|venue|club|stadium|theatre|theater|comedy|festival|proms|turnout|biggest|busiest|near me|nearby|my area)\b/i;

const EVENT_REFUSAL_RE =
  /don'?t want.{0,40}events?|not (about )?events|no events|besides events|other than events|instead of events/i;

export function classifyAgentIntent(question: string): AgentIntent {
  const q = question.trim();
  const travel = TRAVEL_RE.test(q);
  const events = !EVENT_REFUSAL_RE.test(q) && EVENTS_RE.test(q);
  if (travel && events) return 'mixed';
  if (travel) return 'travel';
  if (events) return 'events';
  // Unknown questions keep full context so we do not starve the model.
  return 'mixed';
}

export function wantsEventContext(intent: AgentIntent): boolean {
  return intent !== 'travel';
}

export function wantsFlightContext(intent: AgentIntent): boolean {
  return intent !== 'events';
}

export function wantsCatalogueLookup(intent: AgentIntent): boolean {
  return intent !== 'travel';
}
