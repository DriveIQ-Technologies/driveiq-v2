import type { Ionicons } from '@expo/vector-icons';

export type PremiumUnlockItem = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  title: string;
  body: string;
};

/** Shown on the paywall and the post-purchase walkthrough. */
export const PREMIUM_UNLOCK_ITEMS: PremiumUnlockItem[] = [
  {
    icon: 'airplane',
    tint: '#4CA9FF',
    title: 'Every flight, all day',
    body: 'Full-day boards at all five airports. Watch as many flights as you like.',
  },
  {
    icon: 'train',
    tint: '#FF7E47',
    title: 'Every hub you work',
    body: 'Save Paddington, Victoria, Liverpool Street, and every station you need.',
  },
  {
    icon: 'calendar',
    tint: '#26C281',
    title: 'Weeks ahead, ranked by demand',
    body: 'Browse the full calendar and see which nights are worth working.',
  },
  {
    icon: 'sparkles',
    tint: '#A78BFA',
    title: 'Unlimited AI questions',
    body: 'Plan a whole shift — no daily cap on the agent.',
  },
];

export type PremiumUnlockOutcome = {
  kind: 'purchase' | 'restore' | 'waitlist';
  trialStarted: boolean;
};

export function premiumUnlockHeadline(outcome: PremiumUnlockOutcome): string {
  if (outcome.kind === 'restore') return 'Premium restored';
  if (outcome.kind === 'waitlist') return 'Your waitlist week starts now';
  if (outcome.trialStarted) return 'Your free week starts now';
  return 'Welcome to Premium';
}

export function premiumUnlockLead(outcome: PremiumUnlockOutcome): string {
  if (outcome.kind === 'restore') {
    return 'Your subscription is active again. Everything below is unlocked on this device.';
  }
  if (outcome.kind === 'waitlist' || outcome.trialStarted) {
    return 'Nothing to pay for 7 days. Here is what you can use straight away:';
  }
  return 'Your subscription is active. Here is what you can use straight away:';
}
