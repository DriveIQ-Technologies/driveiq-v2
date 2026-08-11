import Constants from 'expo-constants';
import PostHog from 'posthog-react-native';
import { Platform } from 'react-native';

type Primitive = string | number | boolean | null;
export type AnalyticsProps = Record<string, Primitive | undefined>;

/** Lazy import avoids a circular dep with subscription.ts (which calls track). */
async function resolveProTier(): Promise<boolean> {
  try {
    const { hasProAccess } = await import('@/services/subscription');
    return await hasProAccess();
  } catch {
    return false;
  }
}

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim() ?? '';
const POSTHOG_HOST =
  process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || 'https://eu.i.posthog.com';

let client: PostHog | null = null;
let warnedMissingKey = false;
/** Last Firebase UID we identified as — avoids noisy re-identify loops. */
let identifiedUid: string | null = null;

/** Shape we need from Firebase Auth without importing the runtime here. */
export interface AnalyticsAuthUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  emailVerified?: boolean;
  metadata?: {
    creationTime?: string;
    lastSignInTime?: string;
  };
  providerData?: Array<{ providerId?: string }>;
}

function isSensitiveEventKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('password') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    // Event payloads: never ship raw email. Person profiles use $email via identify.
    lower === 'email' ||
    lower.endsWith('_email')
  );
}

function sanitizeEventProps(props: AnalyticsProps = {}): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (isSensitiveEventKey(key)) continue;
    const lower = key.toLowerCase();
    // Keep location analytics useful without storing exact coordinates.
    if (
      (lower.includes('lat') || lower.includes('lng') || lower.includes('lon')) &&
      typeof value === 'number'
    ) {
      out[key] = Number(value.toFixed(3));
      continue;
    }
    out[key] = value;
  }
  return {
    ...out,
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version ?? 'unknown',
  };
}

/** Person-profile props — allow $email / $name (PostHog standard). */
function sanitizePersonProps(props: AnalyticsProps = {}): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (lower.includes('password') || lower.includes('token') || lower.includes('secret')) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function getClient(): PostHog | null {
  if (!POSTHOG_KEY) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn('[analytics] EXPO_PUBLIC_POSTHOG_KEY is missing; analytics disabled');
    }
    return null;
  }
  if (client) return client;
  client = new PostHog(POSTHOG_KEY, {
    host: POSTHOG_HOST,
    captureAppLifecycleEvents: true,
  });
  return client;
}

export function initAnalytics(): void {
  const ph = getClient();
  if (!ph) return;
  void ph.register({
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version ?? 'unknown',
    signed_in: false,
    tier: 'anonymous',
  });
  ph.capture('app_bootstrapped', sanitizeEventProps());
}

export function track(event: string, props: AnalyticsProps = {}): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture(event, sanitizeEventProps(props));
}

export function trackScreen(screen: string, props: AnalyticsProps = {}): void {
  track('screen_viewed', { screen, ...props });
}

/**
 * Identify a signed-in Firebase user in PostHog.
 *
 * - Distinct ID = Firebase `uid` (stable across devices/sessions)
 * - Aliases the previous anonymous distinct ID so pre-login events stitch
 * - Sets `$email` / `$name` so PostHog person profiles are searchable
 * - Registers `user_id` / `tier` / `signed_in` as super-properties on every event
 */
export async function identifyFirebaseUser(
  user: AnalyticsAuthUser,
  extras: AnalyticsProps = {},
): Promise<void> {
  const ph = getClient();
  if (!ph || !user?.uid) return;

  const previousDistinctId = ph.getDistinctId();
  const pro = await resolveProTier();
  const tier = pro ? 'pro' : 'free';
  const provider =
    user.providerData?.find((p) => p.providerId && p.providerId !== 'firebase')
      ?.providerId ?? 'password';

  const person: AnalyticsProps = {
    $email: user.email ?? undefined,
    $name: user.displayName?.trim() || undefined,
    email_verified: Boolean(user.emailVerified),
    firebase_uid: user.uid,
    auth_provider: provider,
    account_created_at: user.metadata?.creationTime ?? undefined,
    last_sign_in_at: user.metadata?.lastSignInTime ?? undefined,
    tier,
    signed_in: true,
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version ?? 'unknown',
    ...extras,
  };

  // Merge anonymous pre-login activity into this account once per uid change.
  if (
    previousDistinctId &&
    previousDistinctId !== user.uid &&
    identifiedUid !== user.uid
  ) {
    try {
      ph.alias(user.uid);
    } catch {
      /* non-fatal — identify still works without alias */
    }
  }

  ph.identify(user.uid, sanitizePersonProps(person));
  ph.setPersonPropertiesForFlags({
    tier,
    signed_in: true,
    email_verified: Boolean(user.emailVerified),
  });

  await ph.register({
    user_id: user.uid,
    tier,
    signed_in: true,
    email_verified: Boolean(user.emailVerified),
    auth_provider: provider,
  });

  identifiedUid = user.uid;
}

/** Lightweight trait refresh after profile / entitlement changes. */
export async function refreshUserTraits(
  patch: AnalyticsProps = {},
): Promise<void> {
  const ph = getClient();
  if (!ph || !identifiedUid) return;

  const pro = await resolveProTier();
  const tier = pro ? 'pro' : 'free';
  const person = sanitizePersonProps({
    tier,
    signed_in: true,
    ...patch,
  });
  ph.setPersonProperties(person);
  await ph.register({
    tier,
    signed_in: true,
    ...(typeof patch.email_verified === 'boolean'
      ? { email_verified: patch.email_verified }
      : {}),
  });
}

/** @deprecated Prefer identifyFirebaseUser — kept for call-site compatibility. */
export function identifyUser(
  userId: string,
  userProps: AnalyticsProps = {},
): void {
  const ph = getClient();
  if (!ph) return;
  const previousDistinctId = ph.getDistinctId();
  if (previousDistinctId && previousDistinctId !== userId && identifiedUid !== userId) {
    try {
      ph.alias(userId);
    } catch {
      /* ignore */
    }
  }
  ph.identify(userId, sanitizePersonProps(userProps));
  identifiedUid = userId;
  void ph.register({ user_id: userId, signed_in: true });
}

export function resetAnalyticsUser(): void {
  const ph = getClient();
  if (!ph) return;
  identifiedUid = null;
  void ph.register({
    signed_in: false,
    tier: 'anonymous',
  });
  void ph.unregister('user_id');
  ph.resetPersonPropertiesForFlags();
  ph.reset();
}
