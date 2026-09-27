/**
 * Whether to advertise the free trial for one subscription product.
 *
 * Apple only gives the introductory offer to an Apple ID that hasn't had one
 * in the subscription group, but the product carries the offer either way.
 * Showing "7 days free" to someone who already used it, then charging them
 * at once, is misleading (and grounds for App Review rejection), so on iOS
 * the trial is shown only when RevenueCat confirms eligibility. Google Play
 * already hides offers the account can't use, and RevenueCat always reports
 * Android eligibility as unknown, so there the offer itself is enough.
 */

/** RevenueCat INTRO_ELIGIBILITY_STATUS values. */
export const INTRO_UNKNOWN = 0;
export const INTRO_INELIGIBLE = 1;
export const INTRO_ELIGIBLE = 2;
export const INTRO_NO_OFFER = 3;

export function showFreeTrial(opts: {
  platform: string;
  /** product.introPrice?.price; null when the product has no intro offer. */
  introPrice: number | null | undefined;
  /** From checkTrialOrIntroductoryPriceEligibility; undefined if not checked. */
  eligibility: number | undefined;
}): boolean {
  if (opts.introPrice !== 0) return false;
  if (opts.platform === 'ios') return opts.eligibility === INTRO_ELIGIBLE;
  return true;
}
