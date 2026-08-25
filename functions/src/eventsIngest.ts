/**
 * Nightly eventsRaw ingest (task 08). Ticketmaster Discovery → eventsRaw.
 */
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { addDaysYmd, londonYmd } from './londonTime.js';
import type { RawEvent } from './events.js';

interface TmEvent {
  id?: string;
  name?: string;
  dates?: { start?: { dateTime?: string; localDate?: string; localTime?: string } };
  _embedded?: { venues?: Array<{ name?: string; city?: { name?: string } }> };
  classifications?: Array<{ segment?: { name?: string }; genre?: { name?: string } }>;
}

function tmStartsAt(e: TmEvent): string {
  const dt = e.dates?.start?.dateTime;
  if (dt) return dt;
  const d = e.dates?.start?.localDate;
  const t = e.dates?.start?.localTime ?? '19:00:00';
  if (d) return `${d}T${t}+00:00`;
  return '';
}

export async function fetchTicketmasterTomorrow(apiKey: string): Promise<RawEvent[]> {
  const tomorrow = addDaysYmd(londonYmd(), 1);
  const url =
    'https://app.ticketmaster.com/discovery/v2/events.json' +
    `?apikey=${encodeURIComponent(apiKey)}` +
    '&countryCode=GB' +
    '&city=London' +
    `&startDateTime=${tomorrow}T00:00:00Z` +
    `&endDateTime=${tomorrow}T23:59:59Z` +
    '&size=100' +
    '&sort=date,asc';
  const res = await fetch(url);
  if (!res.ok) {
    logger.warn('events.tm_http', { status: res.status });
    return [];
  }
  const data = (await res.json()) as { _embedded?: { events?: TmEvent[] } };
  const rows = data._embedded?.events ?? [];
  const out: RawEvent[] = [];
  for (const e of rows) {
    const startsAt = tmStartsAt(e);
    if (!startsAt) continue;
    const venue = e._embedded?.venues?.[0]?.name ?? 'London';
    const segment = e.classifications?.[0]?.segment?.name;
    const genre = e.classifications?.[0]?.genre?.name;
    out.push({
      id: String(e.id ?? startsAt),
      title: String(e.name ?? 'Event'),
      venue,
      category: segment,
      subCategory: genre,
      startsAt,
    });
  }
  return out;
}

export async function ingestEventsRaw(
  db: Firestore,
  apiKey: string | undefined,
): Promise<number> {
  if (!apiKey?.trim()) {
    logger.warn('events.ingest_no_key');
    return 0;
  }
  const events = await fetchTicketmasterTomorrow(apiKey);
  let written = 0;
  for (const event of events) {
    const id = event.id.replace(/\//g, '_');
    await db.doc(`eventsRaw/${id}`).set(
      {
        ...event,
        source: 'ticketmaster',
        ingestedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    written += 1;
  }
  logger.info('events.raw_ingested', { count: written });
  return written;
}
