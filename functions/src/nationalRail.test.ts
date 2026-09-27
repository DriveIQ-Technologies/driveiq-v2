import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchServiceIndicators,
  ingestNationalRail,
  lineIdForToc,
  newestDisruptionUrl,
  parseServiceIndicators,
  severityFromStatus,
} from './nationalRail.js';

/** Verbatim from the NSI spec, Appendix A. */
const SPEC_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<NSI xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://nationalrail.co.uk/xml/serviceindicator">
<TOC>
<TocCode>SW</TocCode>
<TocName>South Western Railway</TocName>
<Status>Minor delays on some routes</Status>
<StatusImage>icon-note-noshadow.png</StatusImage>
<ServiceGroup>
<GroupName>Salisbury</GroupName>
<CurrentDisruption>E458ECE5C07246DEA7CAF511CFD4B131</CurrentDisruption>
<CustomDetail><![CDATA[ Read about this disruption ]]></CustomDetail>
<CustomURL>https://www.nationalrail.co.uk/</CustomURL>
</ServiceGroup>
<ServiceGroup>
<GroupName>Esher</GroupName>
<CurrentDisruption>8F438192F0CE41AE89C4D7765002A45C</CurrentDisruption>
<CustomDetail><![CDATA[ Read about this disruption ]]></CustomDetail>
<CustomURL>https://www.nationalrail.co.uk/</CustomURL>
</ServiceGroup>
<TwitterAccount>SW_Help</TwitterAccount>
</TOC>
</NSI>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('severityFromStatus', () => {
  it('reads the real phrases the feed uses', () => {
    expect(severityFromStatus('Good service')).toBe('good');
    expect(severityFromStatus('Minor delays on some routes')).toBe('minor');
    expect(severityFromStatus('Major disruption')).toBe('severe');
    expect(severityFromStatus('Service suspended')).toBe('closed');
  });

  it('prefers the worse reading when a status mentions both', () => {
    expect(severityFromStatus('Good service except severe delays to Woking')).toBe('severe');
  });

  it('treats an unrecognised status as minor, never as good service', () => {
    // A wrong "good" would hide real disruption — the exact bug being replaced.
    expect(severityFromStatus('Something we have never seen')).toBe('minor');
    // An empty status is the one safe case to read as normal service.
    expect(severityFromStatus('')).toBe('good');
  });
});

describe('parseServiceIndicators', () => {
  it('parses the spec sample, including nested service groups', () => {
    const rows = parseServiceIndicators(SPEC_SAMPLE);
    expect(rows).toHaveLength(1);
    const swr = rows[0];
    expect(swr.code).toBe('SW');
    expect(swr.name).toBe('South Western Railway');
    expect(swr.status).toBe('Minor delays on some routes');
    expect(swr.severity).toBe('minor');
    expect(swr.disruptedGroups).toEqual(['Salisbury', 'Esher']);
    expect(swr.url).toBe('https://www.nationalrail.co.uk/');
  });

  it('accepts <Code>/<Name>, which the spec table uses instead of the sample', () => {
    const xml = `<NSI><TOC><Code>GW</Code><Name>Great Western Railway</Name>
      <Status>Good service</Status></TOC></NSI>`;
    const rows = parseServiceIndicators(xml);
    expect(rows[0].code).toBe('GW');
    expect(rows[0].name).toBe('Great Western Railway');
    expect(rows[0].severity).toBe('good');
  });

  it('handles a single TOC and many TOCs identically', () => {
    const many = `<NSI>
      <TOC><TocCode>SW</TocCode><TocName>South Western</TocName><Status>Good service</Status></TOC>
      <TOC><TocCode>SE</TocCode><TocName>Southeastern</TocName><Status>Major disruption</Status></TOC>
    </NSI>`;
    const rows = parseServiceIndicators(many);
    expect(rows.map((r) => r.code)).toEqual(['SW', 'SE']);
    expect(rows[1].severity).toBe('severe');
  });

  it('counts only service groups that carry a disruption id', () => {
    const xml = `<NSI><TOC><TocCode>SW</TocCode><TocName>SWR</TocName>
      <Status>Good service</Status>
      <ServiceGroup><GroupName>Quiet</GroupName></ServiceGroup>
      <ServiceGroup><GroupName>Broken</GroupName><CurrentDisruption>ABC</CurrentDisruption></ServiceGroup>
    </TOC></NSI>`;
    expect(parseServiceIndicators(xml)[0].disruptedGroups).toEqual(['Broken']);
  });

  it('returns nothing for empty or malformed input instead of throwing', () => {
    expect(parseServiceIndicators('')).toEqual([]);
    expect(parseServiceIndicators('not xml at all <<<')).toEqual([]);
    expect(parseServiceIndicators('<NSI></NSI>')).toEqual([]);
  });
});

describe('fetchServiceIndicators', () => {
  it('sends the consumer key as x-apikey', async () => {
    type FetchArgs = [url: string, init?: { headers?: Record<string, string> }];
    const fetchMock = vi.fn(
      async (..._a: FetchArgs) => new Response(SPEC_SAMPLE, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rows = await fetchServiceIndicators({ apiKey: 'KEY123', url: 'https://x/y.xml' });
    expect(rows?.[0].code).toBe('SW');

    expect(fetchMock.mock.calls[0]?.[1]?.headers?.['x-apikey']).toBe('KEY123');
  });

  it('returns null (not an empty list) when the key is rejected', async () => {
    // Must be distinguishable from "all operators fine", or a bad key would
    // silently look like a healthy network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));
    expect(await fetchServiceIndicators({ apiKey: 'bad', url: 'https://x/y.xml' })).toBeNull();
  });

  it('returns null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchServiceIndicators({ apiKey: 'k', url: 'https://x/y.xml' })).toBeNull();
  });
});

/**
 * Verbatim from the LIVE feed (23 Sep 2026). Each shape here broke an
 * assumption the first implementation made from the spec alone:
 *   - <Status> is "Custom" — a pointer to <StatusDescription>, not a status
 *   - <StatusDescription> is CDATA
 *   - <GroupName> is documented but absent from every live entry
 *   - the tag is <CustomURL>, not the spec table's <CustomUrl>
 */
const LIVE_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<NSI xmlns="http://nationalrail.co.uk/xml/serviceindicator">
  <TOC>
    <TocCode>CC</TocCode>
    <TocName>c2c</TocName>
    <Status>Custom</Status>
    <StatusImage>icon-note-noshadow.png</StatusImage>
    <StatusDescription><![CDATA[An amended timetable is in operation]]></StatusDescription>
    <ServiceGroup>
      <CurrentDisruption>CAC6A470012144EAA1557F9359C054A5</CurrentDisruption>
      <CustomDetail><![CDATA[Read about this disruption]]></CustomDetail>
      <CustomURL>https://www.nationalrail.co.uk/service-disruptions/amended-c-2-c-20260818/</CustomURL>
    </ServiceGroup>
  </TOC>
  <TOC>
    <TocCode>GW</TocCode>
    <TocName>Great Western Railway</TocName>
    <Status>Custom</Status>
    <StatusDescription><![CDATA[No trains between Didcot Parkway and Reading]]></StatusDescription>
    <ServiceGroup><CurrentDisruption>A1</CurrentDisruption></ServiceGroup>
    <ServiceGroup><CurrentDisruption>A2</CurrentDisruption></ServiceGroup>
  </TOC>
  <TOC>
    <TocCode>SW</TocCode>
    <TocName>South Western Railway</TocName>
    <Status>Good service</Status>
  </TOC>
  <TOC>
    <TocCode>XR</TocCode>
    <TocName>Elizabeth line</TocName>
    <Status>Good service</Status>
  </TOC>
</NSI>`;

describe('live feed shapes', () => {
  it('reads through Status="Custom" to the CDATA description', () => {
    const c2c = parseServiceIndicators(LIVE_SAMPLE).find((r) => r.code === 'CC');
    // Reading <Status> alone reports every disrupted operator as "Custom".
    expect(c2c?.status).toBe('An amended timetable is in operation');
    expect(c2c?.severity).toBe('minor');
  });

  it('treats "No trains between X and Y" as severe, not an unknown notice', () => {
    const gwr = parseServiceIndicators(LIVE_SAMPLE).find((r) => r.code === 'GW');
    expect(gwr?.severity).toBe('severe');
  });

  it('keeps "no direct service" below "no trains"', () => {
    expect(severityFromStatus('No direct service between Pontypridd and Cardiff Bay')).toBe('minor');
    expect(severityFromStatus('No trains between Oxford and Reading')).toBe('severe');
  });

  it('counts disruptions even though GroupName is absent live', () => {
    const rows = parseServiceIndicators(LIVE_SAMPLE);
    expect(rows.find((r) => r.code === 'GW')?.disruptionCount).toBe(2);
    expect(rows.find((r) => r.code === 'GW')?.disruptedGroups).toEqual([]);
    expect(rows.find((r) => r.code === 'SW')?.disruptionCount).toBe(0);
  });

  it('reads CustomURL as the live feed spells it', () => {
    const c2c = parseServiceIndicators(LIVE_SAMPLE).find((r) => r.code === 'CC');
    expect(c2c?.url).toContain('nationalrail.co.uk/service-disruptions');
  });
});

describe('lineIdForToc', () => {
  it('maps London operators onto the ids the app already renders', () => {
    expect(lineIdForToc('SW')).toBe('south-western-railway');
    expect(lineIdForToc('CC')).toBe('c2c');
    expect(lineIdForToc('TL')).toBe('thameslink');
  });

  it('falls back to a lowercased code for unmapped operators', () => {
    expect(lineIdForToc('ZZ')).toBe('zz');
  });
});

describe('ingestNationalRail', () => {
  const stubDb = () => {
    const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
    return {
      writes,
      db: {
        doc: (path: string) => ({
          set: async (data: Record<string, unknown>) => {
            writes.push({ path, data });
          },
        }),
      } as never,
    };
  };

  it('publishes to railCache/national and drops TfL-owned operators', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(LIVE_SAMPLE, { status: 200 })));
    const { db, writes } = stubDb();

    const n = await ingestNationalRail({ db, apiKey: 'k', url: 'https://x/y.xml' });

    expect(n).toBe(3); // 4 operators minus Elizabeth line
    expect(writes[0].path).toBe('railCache/national');
    const ops = writes[0].data.operators as Array<{ code: string; lineId: string }>;
    expect(ops.some((o) => o.code === 'XR')).toBe(false);
    expect(ops.find((o) => o.code === 'SW')?.lineId).toBe('south-western-railway');
  });

  it('keeps the last good cache when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    const { db, writes } = stubDb();

    expect(await ingestNationalRail({ db, apiKey: 'bad', url: 'https://x/y.xml' })).toBe(0);
    // Nothing written: a bad key must not blank every rail line.
    expect(writes).toHaveLength(0);
  });

  it('writes nothing when no key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { db, writes } = stubDb();

    expect(await ingestNationalRail({ db, apiKey: undefined, url: 'https://x/y.xml' })).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe('newestDisruptionUrl', () => {
  it('links the current disruption, not the oldest one listed', () => {
    // Live South Western, 24 Sep 2026: status "Major disruption in the
    // Twickenham area", feed lists disruptions oldest first.
    const urls = [
      'https://www.nationalrail.co.uk/service-disruptions/overton-20260327/',
      'https://www.nationalrail.co.uk/service-disruptions/raynes-park-20260417/',
      'https://www.nationalrail.co.uk/service-disruptions/vauxhall-20260605/',
      'https://www.nationalrail.co.uk/service-disruptions/twickenham-area-20260924/',
    ];
    expect(newestDisruptionUrl(urls)).toContain('twickenham-area-20260924');
  });

  it('falls back to the last listed when no link carries a date', () => {
    expect(newestDisruptionUrl(['https://x/a/', 'https://x/b/'])).toBe('https://x/b/');
  });

  it('returns nothing when there are no links', () => {
    expect(newestDisruptionUrl([])).toBeUndefined();
    expect(newestDisruptionUrl(['', ''])).toBeUndefined();
  });
});
