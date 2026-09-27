import { describe, expect, it } from 'vitest';

import { lineDetailText } from '@/services/tflLines';

describe('lineDetailText', () => {
  it('shows the National Rail message, not the link (GWR at Paddington)', () => {
    // As seen on the station sheet: the whole sentence was in the pill and
    // the row said only "Tap for full details".
    expect(
      lineDetailText({
        severityBucket: 'minor',
        statusDescription:
          'Reduced service between Par and Newquay and disruption between London Paddington and Reading',
        reason: 'https://www.nationalrail.co.uk/service-disruptions/paddington-20260926/',
      }),
    ).toBe(
      'Reduced service between Par and Newquay and disruption between London Paddington and Reading',
    );
  });

  it('shows the TfL reason when that is where the wording is', () => {
    expect(
      lineDetailText({
        severityBucket: 'severe',
        statusDescription: 'Severe Delays',
        reason: 'Severe delays between Paddington and Heathrow Terminals while we fix a train.',
      }),
    ).toBe('Severe delays between Paddington and Heathrow Terminals while we fix a train.');
  });

  it('says nothing extra for good service or a bare repeat of the badge', () => {
    expect(lineDetailText({ severityBucket: 'good', statusDescription: 'Good Service' })).toBe('');
    expect(
      lineDetailText({ severityBucket: 'minor', statusDescription: 'Minor disruption', reason: '' }),
    ).toBe('');
  });
});
