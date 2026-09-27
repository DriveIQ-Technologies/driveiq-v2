import { describe, expect, it } from 'vitest';

import {
  INTRO_ELIGIBLE,
  INTRO_INELIGIBLE,
  INTRO_NO_OFFER,
  INTRO_UNKNOWN,
  showFreeTrial,
} from '@/utils/trialEligibility';

describe('showFreeTrial', () => {
  it('shows the trial on iOS only when Apple says this Apple ID can have it', () => {
    expect(showFreeTrial({ platform: 'ios', introPrice: 0, eligibility: INTRO_ELIGIBLE })).toBe(true);
    // Already used the trial: Apple would charge straight away.
    expect(showFreeTrial({ platform: 'ios', introPrice: 0, eligibility: INTRO_INELIGIBLE })).toBe(false);
    expect(showFreeTrial({ platform: 'ios', introPrice: 0, eligibility: INTRO_UNKNOWN })).toBe(false);
    expect(showFreeTrial({ platform: 'ios', introPrice: 0, eligibility: undefined })).toBe(false);
  });

  it('never shows a trial the product does not have', () => {
    // What the screenshot showed: no intro offer on the product.
    expect(showFreeTrial({ platform: 'ios', introPrice: null, eligibility: INTRO_NO_OFFER })).toBe(false);
    expect(showFreeTrial({ platform: 'android', introPrice: undefined, eligibility: undefined })).toBe(false);
    // A paid intro price is not a free trial.
    expect(showFreeTrial({ platform: 'ios', introPrice: 0.99, eligibility: INTRO_ELIGIBLE })).toBe(false);
  });

  it('trusts the offer on Android, where Play hides offers the account cannot use', () => {
    expect(showFreeTrial({ platform: 'android', introPrice: 0, eligibility: INTRO_UNKNOWN })).toBe(true);
  });
});
