/**
 * Plain-template copy. Used when Claude is down (task 07 safety net) and
 * on-device until the Cloud Function has written a Firestore line.
 *
 * Thresholds live in code. These functions only phrase a record that has
 * already been judged worth showing.
 */

import type { TrafficIncident } from '@/services/tflTraffic';
import type { LineStatus } from '@/services/tflLines';
import type { AppEvent } from '@/types/event';

const clean = (s?: string | null): string =>
  (s ?? '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();

const hhmm = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
};

export function templateRoadLine(
  incident: TrafficIncident,
  corridorLabel: string,
): string {
  const location = clean(incident.location);
  const comments = clean(incident.comments);
  const combined = `${location} ${comments}`.trim();

  const junctionMatch = combined.match(/\bJ(?:unction)?\s?(\d{1,2}[A-Za-z]?)\b/i);
  const junction = junctionMatch ? `J${junctionMatch[1].toUpperCase()}` : '';

  let landmark = '';
  if (junction) {
    const after = combined.match(
      /\bJ(?:unction)?\s?\d{1,2}[A-Za-z]?\b[\s,:-]*([A-Za-z][A-Za-z0-9'()./&\s-]{2,40})/i,
    );
    landmark = clean(after?.[1]).replace(/\b(anticlockwise|clockwise|eastbound|westbound|northbound|southbound)\b.*$/i, '').trim();
  }
  if (!landmark && location) {
    const parts = location.split(',');
    landmark = clean(parts.length > 1 ? parts[1] : parts[0]);
  }

  const dirMatch = combined.match(
    /\b(anticlockwise|clockwise|eastbound|westbound|northbound|southbound)\b/i,
  );
  const direction = dirMatch ? dirMatch[1].toLowerCase() : '';

  const reason = clean(incident.subCategory) || clean(incident.category) || 'disruption';
  const where = [junction, landmark].filter(Boolean).join(' ');
  const clear = hhmm(incident.endsAt);

  const head = direction
    ? `${corridorLabel} ${direction}${where ? ` at ${where}` : ''}`
    : where
      ? `${corridorLabel} at ${where}`
      : location || corridorLabel;

  let line = `${head}. ${reason}.`;
  if (incident.hasClosures) {
    line = `${head} is closed. ${reason}.`;
  }
  if (clear) line += ` Expect it clear around ${clear}.`;
  return line.replace(/\s+/g, ' ').trim();
}

export function templateRailLine(line: LineStatus): string {
  const reason = clean(line.reason);
  const status = clean(line.statusDescription) || line.severityBucket;
  if (line.severityBucket === 'closed') {
    return reason
      ? `${line.name} is down. ${reason}`
      : `${line.name} is down. Check Connections before you set off.`;
  }
  return reason
    ? `${line.name}: ${status}. ${reason}`
    : `${line.name}: ${status}. Check Connections before you set off.`;
}

export function templateFlightLine(input: {
  flight: string;
  airport: string;
  status: string;
  dueAt?: string | null;
}): string {
  const due = hhmm(input.dueAt);
  const status = clean(input.status) || 'delayed';
  return due
    ? `${input.flight} into ${input.airport} is ${status}. Due ${due}.`
    : `${input.flight} into ${input.airport} is ${status}.`;
}

export function templateEventLine(event: AppEvent): string {
  const kind = event.subCategory || (event.category === 'sports' ? 'Sport' : 'Event');
  const venue = event.venue || 'London';
  const finish = hhmm(event.estimatedFinishAt || event.endsAt);
  if (finish) return `${kind} at ${venue}. Crowds leaving around ${finish}.`;
  return `${kind} at ${venue}.`;
}
