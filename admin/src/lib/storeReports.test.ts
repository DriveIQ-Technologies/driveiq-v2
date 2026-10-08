import { describe, expect, it } from 'vitest';

import {
  appleReportDay,
  buildStoreDownloads,
  decodeSecret,
  parseAppleSalesTsv,
  parsePlayInstallsCsv,
  storeSetupNote,
} from './storeReports';

const APPLE = [
  'Provider\tProvider Country\tSKU\tTitle\tProduct Type Identifier\tUnits\tBegin Date\tApple Identifier',
  'DRIVEIQ\tGB\tdriveiq.app\tDriveIQ\t1F\t20\t10/05/2026\t6795638906',
  'DRIVEIQ\tUS\tdriveiq.app\tDriveIQ\t1\t5\t10/05/2026\t6795638906',
  'DRIVEIQ\tGB\tdriveiq.app\tDriveIQ\t7\t100\t10/05/2026\t6795638906',
  'DRIVEIQ\tGB\tdriveiq.premium\tPremium\tIA1\t4\t10/05/2026\t6795638906',
  'OTHER\tGB\tother.app\tOther\t1\t9\t10/05/2026\t111',
].join('\n');

describe('parseAppleSalesTsv', () => {
  it('counts first downloads for DriveIQ and skips updates, purchases, and other apps', () => {
    const days = parseAppleSalesTsv(APPLE);
    expect(days.get('2026-10-05')).toBe(25);
    expect([...days.keys()]).toEqual(['2026-10-05']);
  });

  it('reads Apple dates as MM/DD/YYYY', () => {
    expect(appleReportDay('10/05/2026')).toBe('2026-10-05');
  });
});

describe('parsePlayInstallsCsv', () => {
  it('reads daily user installs and the running total', () => {
    const csv = [
      'Date,Package name,Daily Device Installs,Daily User Installs,Total User Installs',
      '2026-10-05,driveiq.app,8,6,40',
      '2026-10-06,driveiq.app,3,2,42',
    ].join('\n');
    expect(parsePlayInstallsCsv(csv)).toEqual([
      { day: '2026-10-05', daily: 6, total: 40 },
      { day: '2026-10-06', daily: 2, total: 42 },
    ]);
  });
});

describe('buildStoreDownloads', () => {
  it('uses the Play lifetime total and adds both stores on the chart', () => {
    const report = buildStoreDownloads({
      appleByDay: new Map([
        ['2026-10-05', 25],
        ['2026-10-06', 4],
      ]),
      playRows: [
        { day: '2026-10-05', daily: 6, total: 40 },
        { day: '2026-10-06', daily: 2, total: 42 },
      ],
      chartDays: ['2026-10-04', '2026-10-05', '2026-10-06'],
    });
    expect(report.ios).toBe(29);
    expect(report.android).toBe(42);
    expect(report.total).toBe(71);
    expect(report.perDay).toEqual([
      { day: '2026-10-04', count: 0 },
      { day: '2026-10-05', count: 31 },
      { day: '2026-10-06', count: 6 },
    ]);
    expect(report.last7).toBe(37);
    expect(report.through).toBe('2026-10-06');
  });
});

describe('storeSetupNote', () => {
  it('names the store that is not connected', () => {
    expect(storeSetupNote(['APPSTORE_KEY_ID', 'PLAY_REPORTS_BUCKET'])).toMatch(/App Store Connect and Google Play/);
    expect(storeSetupNote(['PLAY_SERVICE_ACCOUNT'])).toMatch(/Google Play/);
    expect(storeSetupNote([])).toBeNull();
  });

  it('turns escaped newlines in a pasted key back into real lines', () => {
    expect(decodeSecret('-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----')).toBe(
      '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----',
    );
  });
});
