/**
 * Events admin page: add or remove events by hand (manualEvents).
 *
 * One passcode (secret EVENTS_ADMIN_KEY) guards every read and write. Served
 * straight from the function so it works from a phone with no app release.
 * Saved events are shown the way the app's event sheet lays them out, read
 * back from eventsPublished — so what you see here is what drivers see.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { recordIdFor } from './eventNormalise.js';
import {
  buildManualEvent,
  loadManualEvents,
  manualEventId,
  manualRawId,
  manualToPublished,
  manualVenueOptions,
  MANUAL_OTHER_TYPES,
  MANUAL_SPORTS_TYPES,
  type ManualEventDoc,
} from './manualEvents.js';

interface Req {
  method: string;
  body?: Record<string, unknown>;
}
interface Res {
  status(code: number): Res;
  set(name: string, value: string): Res;
  send(body: string): void;
}

const FORM_FIELDS = [
  'title',
  'type',
  'venue',
  'venueName',
  'postcode',
  'date',
  'doorsTime',
  'startTime',
  'endTime',
  'crowd',
  'note',
  'url',
] as const;

function sameKey(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function londonDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function londonHhmm(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

async function postcodeToLatLon(postcode: string): Promise<{ lat: number; lon: number } | null> {
  const pc = postcode.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{5,7}$/.test(pc)) return null;
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${pc}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: { latitude?: number; longitude?: number } };
    const lat = Number(json.result?.latitude);
    const lon = Number(json.result?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  }
}

function rawDocFor(docId: string, d: ManualEventDoc): Record<string, unknown> {
  const e = manualToPublished(docId, d);
  return {
    id: e.id,
    source: e.source,
    category: e.category,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    endIsEstimated: d.endIsEstimated,
    venue: e.venue,
    latitude: e.latitude,
    longitude: e.longitude,
    description: null,
    subCategory: e.subCategory ?? null,
    url: e.url ?? null,
    ingestedAt: new Date().toISOString(),
  };
}

interface Listed {
  docId: string;
  doc: ManualEventDoc;
  /** The eventsPublished record, when it is live. */
  live: Record<string, unknown> | null;
}

/** Same order and wording as the app's event sheet. */
function eventCard(item: Listed, keyField: string): string {
  const d = item.doc;
  const live = item.live ?? {};
  const str = (k: string) => (typeof live[k] === 'string' ? (live[k] as string) : '');
  const start = str('realStartAt') || d.startsAt;
  const finish = str('estimatedFinishAt') || str('endsAt') || d.endsAt;
  const doors = str('doorsAt');
  const showDoors = doors && Math.abs(Date.parse(doors) - Date.parse(start)) >= 10 * 60 * 1000;
  const tMin = Number(live.turnoutMin);
  const tMax = Number(live.turnoutMax);
  const turnout =
    tMin > 0 && tMax > 0
      ? `${tMin.toLocaleString('en-GB')} to ${tMax.toLocaleString('en-GB')}`
      : '';
  const about = str('copyLine') || str('description');
  const meta = (label: string, value: string) =>
    value ? `<div class="meta"><span>${label}</span><span>${esc(value)}</span></div>` : '';

  return `<li class="event">
<div class="tagrow"><span class="tag${d.category === 'sports' ? '' : ' other'}">${esc(d.subCategory)}</span>
<span class="${item.live ? 'live' : 'pending'}">${item.live ? 'Live in app' : 'Waiting for the next update'}</span></div>
<div class="title">${esc(d.title)}</div>
<div class="date">${esc(londonDate(start))}</div>
${showDoors ? `<div class="sub">Doors ${esc(londonHhmm(doors))}</div>` : ''}
<div class="sub">Crowds leaving around ${esc(londonHhmm(finish))}${d.endIsEstimated && !d.overrides?.estimatedFinishAt ? ' (estimated)' : ''}</div>
${meta('Venue', d.venue)}${meta('Turnout', turnout)}${meta('About', about)}
<form method="post" onsubmit="return confirm('Remove this event from the app?')">${keyField}
<input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${esc(item.docId)}">
<button class="danger">Remove</button></form></li>`;
}

function page(opts: {
  key: string;
  message?: { ok: boolean; text: string };
  events?: Listed[];
  form?: Record<string, string>;
}): string {
  const f = opts.form ?? {};
  const val = (k: string) => esc(f[k] ?? '');
  const venues = manualVenueOptions()
    .map((v) => `<option${f.venue === v.venue ? ' selected' : ''}>${esc(v.venue)}</option>`)
    .join('');
  const typeOpts = (list: readonly string[]) =>
    list.map((t) => `<option${f.type === t ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const keyField = `<input type="hidden" name="key" value="${esc(opts.key)}">`;

  const listed = opts.events
    ? opts.events.length
      ? `<ul>${opts.events.map((e) => eventCard(e, keyField)).join('')}</ul>`
      : '<p class="muted">No upcoming events added by hand.</p>'
    : `<form method="post"><input type="hidden" name="action" value="list">
<input type="password" name="key" placeholder="Passcode" required><button class="secondary">Show events</button></form>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>DriveIQ events</title><style>
:root{--bg:#F4F7FA;--card:#FFFFFF;--text:#0E2A3A;--muted:#5B7080;--line:#E2EAF0;--primary:#2D7DF6;--sports:#2D7DF6;--other:#7A5AF8;--ok:#1E9E62;--wait:#B7791F;--bad:#D14343}
@media (prefers-color-scheme:dark){:root{--bg:#0B1620;--card:#13212D;--text:#EAF1F6;--muted:#93A6B5;--line:#223442;--primary:#5A9BFF;--sports:#5A9BFF;--other:#A58BFF;--ok:#4CC38A;--wait:#E0B155;--bad:#FF7B72}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:20px 16px 48px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
label{display:block;font-size:14px;font-weight:600;color:var(--muted);margin:14px 0 4px}label small{font-weight:400}
input,select{width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text);font:inherit}
.row{display:flex;gap:10px}.row>div{flex:1;min-width:0}
button{margin-top:18px;width:100%;padding:13px;border:0;border-radius:12px;background:var(--primary);color:#fff;font:700 16px system-ui}
button.secondary{background:transparent;color:var(--primary);border:1px solid var(--line)}
button.danger{width:auto;margin-top:12px;padding:8px 14px;background:transparent;color:var(--bad);border:1px solid var(--line);font-weight:600}
.muted{color:var(--muted);font-size:14px;margin:4px 0}.msg{padding:12px;border-radius:12px;margin:14px 0;border:1px solid var(--line);background:var(--card);font-weight:600}
.msg.ok{color:var(--ok)}.msg.bad{color:var(--bad)}
ul{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.event{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.tagrow{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;font-size:13px}
.tag{background:var(--sports);color:#fff;font-weight:700;padding:5px 10px;border-radius:999px}.tag.other{background:var(--other)}
.live{color:var(--ok);font-weight:600}.pending{color:var(--wait);font-weight:600}
.title{font-size:20px;font-weight:800}.date{font-size:15px;font-weight:600;margin-top:4px}.sub{font-size:14px;color:var(--muted);margin-top:2px}
.meta{display:flex;gap:12px;margin-top:10px;font-size:14px}.meta span:first-child{width:72px;flex:none;color:var(--muted);font-weight:600}
#other{display:${f.venue === 'other' ? 'block' : 'none'}}
</style></head><body><main>
<h1>Add an event</h1><p class="muted">For events the feeds miss. It goes live in the app straight after you save.</p>
${opts.message ? `<div class="msg ${opts.message.ok ? 'ok' : 'bad'}">${esc(opts.message.text)}</div>` : ''}
<form method="post" class="card"><input type="hidden" name="action" value="add">
<label>Passcode</label><input type="password" name="key" value="${esc(opts.key)}" required autocomplete="current-password">
<label>Title</label><input name="title" value="${val('title')}" placeholder="England v Spain" maxlength="140" required>
<label>Type</label><select name="type" required><option value="">Choose…</option>
<optgroup label="Sport">${typeOpts(MANUAL_SPORTS_TYPES)}</optgroup><optgroup label="Not sport">${typeOpts(MANUAL_OTHER_TYPES)}</optgroup></select>
<label>Venue</label><select name="venue" id="venue" required><option value="">Choose…</option>${venues}
<option value="other"${f.venue === 'other' ? ' selected' : ''}>Other venue…</option></select>
<div id="other"><label>Venue name</label><input name="venueName" value="${val('venueName')}" maxlength="100">
<label>Venue postcode</label><input name="postcode" value="${val('postcode')}" placeholder="HA9 0WS"></div>
<label>Date</label><input type="date" name="date" value="${val('date')}" required>
<div class="row"><div><label>Doors</label><input type="time" name="doorsTime" value="${val('doorsTime')}"></div>
<div><label>Start</label><input type="time" name="startTime" value="${val('startTime')}" required></div>
<div><label>Finish</label><input type="time" name="endTime" value="${val('endTime')}"></div></div>
<p class="muted">London time. Only the start is needed: leave doors or finish blank and we estimate them for the venue.</p>
<label>Expected crowd <small>(optional)</small></label><input name="crowd" inputmode="numeric" value="${val('crowd')}" placeholder="90000">
<label>Driver note <small>(optional, shown as “About”)</small></label><input name="note" value="${val('note')}" maxlength="160" placeholder="Sold out. Wembley Park station very busy after the final whistle.">
<label>Link <small>(optional)</small></label><input name="url" value="${val('url')}" placeholder="https://">
<button>Save event</button></form>
<h2>Added by hand</h2>
${listed}
<script>document.getElementById('venue').addEventListener('change',function(e){document.getElementById('other').style.display=e.target.value==='other'?'block':'none'})</script>
</main></body></html>`;
}

async function listWithLive(db: Firestore): Promise<Listed[]> {
  const events = await loadManualEvents(db);
  const snaps = await Promise.all(
    events.map(({ docId }) => db.doc(`eventsPublished/${recordIdFor(manualRawId(docId))}`).get()),
  );
  return events.map((e, i) => ({
    ...e,
    live: snaps[i]?.exists ? ((snaps[i].data() ?? null) as Record<string, unknown> | null) : null,
  }));
}

export async function handleEventsAdmin(opts: {
  db: Firestore;
  req: Req;
  res: Res;
  adminKey: string | undefined;
  /** Rebuild the published catalogue from eventsRaw. */
  republish: () => Promise<void>;
}): Promise<void> {
  const { db, req, res } = opts;
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('X-Frame-Options', 'DENY');

  if (req.method === 'GET') {
    res.status(200).send(page({ key: '' }));
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const form: Record<string, string> = {};
  for (const k of FORM_FIELDS) form[k] = str(k);
  const key = str('key');

  if (!opts.adminKey || !key || !sameKey(key, opts.adminKey)) {
    logger.warn('events_admin.bad_key');
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 1500));
    res.status(401).send(page({ key: '', form, message: { ok: false, text: 'Wrong passcode.' } }));
    return;
  }

  const action = str('action');
  let message: { ok: boolean; text: string } | undefined;
  let keepForm = false;

  if (action === 'add') {
    let latitude: number | undefined;
    let longitude: number | undefined;
    if (form.venue === 'other') {
      const found = await postcodeToLatLon(form.postcode);
      if (found) {
        latitude = found.lat;
        longitude = found.lon;
      }
    }
    const built = buildManualEvent({ ...form, latitude, longitude });
    if (!built.ok) {
      message = { ok: false, text: built.error };
      keepForm = true;
    } else {
      const docId = manualEventId(built.event);
      const recordId = recordIdFor(manualRawId(docId));
      await db.doc(`manualEvents/${docId}`).set(built.event);
      await db.doc(`eventsRaw/${recordId}`).set(rawDocFor(docId, built.event));
      // Saving the same event again with a field cleared must clear it here too.
      if (Object.keys(built.event.overrides).length) {
        await db.doc(`eventOverrides/${recordId}`).set(built.event.overrides);
      } else {
        await db.doc(`eventOverrides/${recordId}`).delete();
      }
      try {
        await opts.republish();
        message = { ok: true, text: `Saved: ${built.event.title}. It is live in the app now.` };
      } catch (e) {
        logger.warn('events_admin.republish_fail', { error: e instanceof Error ? e.message : 'error' });
        message = {
          ok: true,
          text: `Saved: ${built.event.title}. It will appear at the next update (within 12 hours).`,
        };
      }
      logger.info('events_admin.added', { docId, venue: built.event.venue, startsAt: built.event.startsAt });
    }
  } else if (action === 'delete') {
    const docId = str('id');
    if (/^[a-z0-9-]{1,80}$/.test(docId)) {
      const recordId = recordIdFor(manualRawId(docId));
      await Promise.all([
        db.doc(`manualEvents/${docId}`).delete(),
        db.doc(`eventsRaw/${recordId}`).delete(),
        db.doc(`eventsPublished/${recordId}`).delete(),
        db.doc(`eventRecords/${recordId}`).delete(),
        db.doc(`eventOverrides/${recordId}`).delete(),
      ]);
      logger.info('events_admin.removed', { docId });
      message = { ok: true, text: 'Removed from the app.' };
    }
  }

  const events = await listWithLive(db);
  res.status(200).send(page({ key, message, events, form: keepForm ? form : undefined }));
}
