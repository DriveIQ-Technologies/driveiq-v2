/**
 * Auth context for DriveIQ.
 *
 * Per work order task 09:
 * - Browse is free (anonymous Firebase uid from first open).
 * - Acting (save, notify, watch flight, AI question, calendar) needs a real
 *   account. The create-account prompt fires at that moment, then the pending
 *   action completes after signup / sign-in.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { User } from 'firebase/auth';

import {
  identifyFirebaseUser,
  refreshUserTraits,
  resetAnalyticsUser,
  track,
} from '@/services/analytics';
import { auth, authApi } from '@/services/firebase';
import { configureGoogleSignIn, getGoogleSignInIdToken } from '@/services/googleSignIn';
import { registerAccount } from '@/services/accountRegistration';
import { applyWaitlistOnAuth, type WaitlistClaimHints } from '@/services/waitlist';
import { syncPremiumEntitlement } from '@/services/subscription';
import { identifyPurchasesUser } from '@/services/purchases';
import { registerPushToken, clearPushTokenOnLogout } from '@/services/pushTokens';

export type AccountAction =
  | 'save'
  | 'notify'
  | 'watched_flight'
  | 'ai_question'
  | 'add_to_calendar'
  | 'report';

export interface AccountPromptState {
  open: boolean;
  /** Defaults to signup — first-action moment is create account. */
  mode: 'signin' | 'signup';
  action: AccountAction | null;
  reason: string;
}

export interface AuthContextValue {
  /** Firebase user (may be anonymous). */
  user: User | null;
  /** True until the first auth-state callback resolves. */
  initializing: boolean;
  /** True when the user has a real (non-anonymous) account. */
  hasAccount: boolean;
  /** Prompt opened when a gated action is attempted while signed out. */
  accountPrompt: AccountPromptState;
  closeAccountPrompt: () => void;
  /**
   * If the user has an account, runs `onReady` now and returns true.
   * Otherwise opens Create your account with the doc reason and queues
   * `onReady` to run after a successful signup / sign-in.
   */
  requireAccount: (action: AccountAction, onReady: () => void) => boolean;
  /**
   * Host screen registers a callback that closes every open sheet. iOS gives
   * each RN Modal its own window, and presenting the auth sheet on top of an
   * already-presented one wedges touch handling for the whole app, so the
   * gated action dismisses what's open before the prompt is presented.
   */
  registerSheetDismisser: (fn: (() => void) | null) => void;
  /**
   * The gated action that just finished after a successful signup / sign-in,
   * so the host can restore the surface the user was on. Cleared by
   * `clearCompletedAction`.
   */
  completedAction: AccountAction | null;
  clearCompletedAction: () => void;
  login: (email: string, password: string, waitlist?: WaitlistClaimHints) => Promise<void>;
  loginWithApple: (waitlist?: WaitlistClaimHints) => Promise<void>;
  loginWithGoogle: (waitlist?: WaitlistClaimHints) => Promise<void>;
  signup: (name: string, email: string, password: string, waitlist?: WaitlistClaimHints) => Promise<void>;
  logout: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  /** Firebase verify link. Returns true only if the email actually left. */
  sendVerificationEmail: () => Promise<boolean>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  updateUserEmail: (currentPassword: string, newEmail: string) => Promise<void>;
  /** Permanently deletes account + server data (App Store 5.1.1(v)). */
  deleteAccount: () => Promise<void>;
}

/**
 * Ceiling on the Firebase half of a federated sign-in.
 *
 * Exchanging an Apple credential is a network call with no timeout of its own,
 * so on a weak connection it sits there indefinitely — the user watches a
 * spinner for a minute and then gets a failure with no idea why. Fail fast and
 * say what happened instead.
 */
const CREDENTIAL_EXCHANGE_MS = 20_000;

class SignInTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new SignInTimeoutError('credential-exchange-timeout')),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Run the after-sign-in housekeeping without ever failing the sign-in.
 *
 * Once Firebase has returned a user, the user IS signed in — profile updates,
 * analytics identify, waitlist claim and entitlement sync are all bookkeeping
 * that happens afterwards. Awaiting them bare meant any one of them rejecting
 * (a flaky network, PostHog, StoreKit with no signed-in App Store account —
 * common on a review device) rejected the whole `loginWith…` call. The sheet
 * then showed a generic failure and never closed, so a user who had just
 * successfully authenticated was told "Something went wrong. Please try again."
 * and left staring at the sign-in form. That is the App Review 2.1(a) bug.
 *
 * Each step is isolated so one failure cannot take down the others either.
 */
async function settleAfterSignIn(
  label: string,
  steps: Array<() => void | Promise<unknown>>,
): Promise<void> {
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      // Swallowed on purpose — the user is signed in and stays signed in —
      // but never silently: tagged as post_signin so it is visible.
      reportAuthFailure(label, 'post_signin', e);
    }
  }
}

/**
 * Stage-tagged failure reporting for federated sign-in.
 *
 * "Something went wrong" told us nothing: the flow has four places it can fail
 * (Apple's own sheet, building the credential, the Firebase exchange, the
 * bookkeeping afterwards) and they need completely different fixes. Every
 * failure is now tagged with the stage and the raw code/message, sent to
 * analytics in every build and printed verbatim in a dev build.
 *
 * This is a deliberate diagnostic channel, not general logging — it fires only
 * on an auth failure, never on the happy path.
 */
/**
 * An error whose message is already the exact sentence the user should read.
 *
 * `friendlyAuthError` maps Firebase codes to copy and falls back to a generic
 * line for anything it does not recognise — which silently discarded every
 * message this file throws by hand, including the ones naming the precise
 * Firebase misconfiguration. Throw this instead of a bare Error and the text
 * survives all the way to the sheet.
 */
export class AuthMessageError extends Error {
  readonly userFacing = true;

  constructor(message: string) {
    super(message);
    this.name = 'AuthMessageError';
  }
}

function isUserFacing(e: unknown): e is AuthMessageError {
  return (
    e instanceof AuthMessageError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { userFacing?: unknown }).userFacing === true)
  );
}

export type AuthStage =
  | 'apple_request'
  | 'apple_credential'
  | 'firebase_exchange'
  | 'post_signin';

function describeError(e: unknown): { code: string; name: string; message: string } {
  const obj = typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : {};
  return {
    code: obj.code != null ? String(obj.code) : '',
    name: e instanceof Error ? e.name : String(obj.name ?? ''),
    message: e instanceof Error ? e.message : String(obj.message ?? e),
  };
}

function reportAuthFailure(provider: string, stage: AuthStage, e: unknown): {
  code: string;
  name: string;
  message: string;
} {
  const info = describeError(e);
  lastAuthFailure = { stage, code: info.code, message: info.message };
  track('auth_stage_failed', {
    provider,
    stage,
    code: info.code || 'none',
    name: info.name || 'none',
    message: info.message.slice(0, 300),
  });
  if (__DEV__) {
    // Separate arguments, not one template string: LogBox renders a lone
    // concatenated string unreliably (it can surface as just "null"), whereas
    // a label plus an object is always shown in full in Metro and the redbox.
    // eslint-disable-next-line no-console
    console.error(`[auth] ${provider} failed at stage: ${stage}`, {
      stage,
      provider,
      code: info.code || '(none)',
      name: info.name || '(none)',
      message: info.message || '(none)',
      raw: safeJson(e),
    });
  }
  return info;
}

/**
 * Last auth failure, for the dev-only detail line in the sign-in sheet.
 *
 * The console is not a reliable channel here — LogBox mangles long strings and
 * Metro output is easy to miss — so in a dev build the sheet itself shows the
 * stage and raw code. That is the difference between "something went wrong"
 * and knowing exactly which of the four stages broke.
 */
let lastAuthFailure: { stage: AuthStage; code: string; message: string } | null = null;

export function getLastAuthFailure(): typeof lastAuthFailure {
  return lastAuthFailure;
}

function safeJson(e: unknown): string {
  try {
    return JSON.stringify(e, Object.getOwnPropertyNames(Object(e))).slice(0, 600);
  } catch {
    return '(unserialisable)';
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LAST_EMAIL_KEY = 'diq:lastEmail';

const ACTION_REASON =
  'Sign up to unlock saves, alerts, and AI. It is free.';

const ACTION_REASON_BY_ACTION: Record<AccountAction, string> = {
  save: 'Sign up to save events and access them anytime. It is free.',
  notify: 'Sign up to turn on personalised alerts and notifications. It is free.',
  watched_flight: 'Sign up to watch flights for delays and cancellations. It is free.',
  ai_question: 'Sign up to keep AI answers on this account. It is free.',
  add_to_calendar: 'Sign up to add events to your calendar. It is free.',
  report: 'Sign up to report hazards so other drivers can see them. It is free.',
};

const emptyPrompt = (): AccountPromptState => ({
  open: false,
  mode: 'signup',
  action: null,
  reason: ACTION_REASON,
});

/**
 * Matches the handshake the sidebar already uses: let the open sheet finish
 * sliding out before presenting the next one, so the two modal windows never
 * overlap.
 */
const SHEET_DISMISS_MS = 300;

/** Default Firebase template only — a custom continue URL often fails silently. */
async function sendVerifyLink(user: User): Promise<boolean> {
  if (!authApi) return false;
  try {
    await authApi.sendEmailVerification(user);
    track('auth_verification_email_sent');
    return true;
  } catch (e) {
    track('auth_verification_email_failed');
    return false;
  }
}

async function ensureAnonymousUser(): Promise<void> {
  if (!auth || !authApi) return;
  if (auth.currentUser) return;
  try {
    await authApi.signInAnonymously(auth);
    track('auth_anonymous_started');
  } catch (e) {
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [accountPrompt, setAccountPrompt] = useState<AccountPromptState>(emptyPrompt);
  const [completedAction, setCompletedAction] = useState<AccountAction | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const pendingActionKindRef = useRef<AccountAction | null>(null);
  const hadAccountRef = useRef(false);
  const dismissSheetsRef = useRef<(() => void) | null>(null);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  useEffect(() => {
    if (!auth || !authApi) {
      setInitializing(false);
      return;
    }
    const authInstance = auth;
    const api = authApi;

    // Sync path: if Firebase already restored a session, surface it before the
    // first paint of the map so splash can dismiss on a known user.
    const existing = authInstance.currentUser;
    if (existing) {
      setUser(existing);
      setInitializing(false);
    }

    const unsub = api.onAuthStateChanged(authInstance, (u) => {
      if (!u) {
        // Browse freely with a stable anonymous uid (doc task 09).
        void ensureAnonymousUser().then(() => {
          if (!authInstance.currentUser) {
            setUser(null);
            resetAnalyticsUser();
            setInitializing(false);
          }
        });
        return;
      }

      // Mark ready immediately — analytics / premium are non-blocking. Waiting
      // on them previously held initializing=true through the splash and made
      // the whole chrome feel stuck.
      setUser(u);
      setInitializing(false);

      // Tie RevenueCat to Firebase uid (anonymous or full account).
      void identifyPurchasesUser(u.uid);

      const hasAccount = !u.isAnonymous;
      if (hasAccount) {
        void identifyFirebaseUser(u).then(() => {
          track('auth_state_changed', { signed_in: true, anonymous: false });
        });
        void syncPremiumEntitlement();
        void registerPushToken();
        void (async () => {
          const { refreshWaitlistForCurrentUser } = await import('@/services/waitlist');
          await refreshWaitlistForCurrentUser();
        })();
        void (async () => {
          const { loadPrefs, loadLineSubscriptions } = await import('@/services/notifications');
          const { loadSavedFlights } = await import('@/services/savedFlights');
          const { loadSavedEvents } = await import('@/services/savedEvents');
          const { syncUserProfileFromLocal } = await import('@/services/userSync');
          await syncUserProfileFromLocal(
            await loadPrefs(),
            await loadLineSubscriptions(),
            Object.values(await loadSavedFlights()),
            Object.values(await loadSavedEvents()),
          );
        })();
      } else {
        void identifyFirebaseUser(
          {
            uid: u.uid,
            email: null,
            displayName: null,
            emailVerified: false,
            metadata: u.metadata,
            providerData: u.providerData,
          },
          { signed_in: false, auth_provider: 'anonymous', tier: 'anonymous' },
        ).then(() => {
          track('auth_state_changed', { signed_in: false, anonymous: true });
        });
      }

      if (u.email) {
        AsyncStorage.setItem(LAST_EMAIL_KEY, u.email).catch(() => undefined);
      }
    });
    return unsub;
  }, []);

  // After signup / sign-in, complete the action that opened the prompt.
  useEffect(() => {
    const hasAccount = Boolean(user && !user.isAnonymous);
    if (hasAccount && !hadAccountRef.current && pendingActionRef.current) {
      const run = pendingActionRef.current;
      const kind = pendingActionKindRef.current;
      pendingActionRef.current = null;
      pendingActionKindRef.current = null;
      setAccountPrompt(emptyPrompt());
      // Defer so sheets can settle after AuthSheet closes.
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        try {
          run();
        } catch (e) {
        }
        if (kind) setCompletedAction(kind);
      }, SHEET_DISMISS_MS);
    }
    hadAccountRef.current = hasAccount;
  }, [user]);

  const requireAuth = () => {
    if (!auth || !authApi) throw new Error('auth/unavailable');
    return { a: auth, api: authApi };
  };

  const reauth = async (currentPassword: string) => {
    const { a, api } = requireAuth();
    const current = a.currentUser;
    if (!current?.email) throw new Error('No authenticated user');
    const cred = api.EmailAuthProvider.credential(current.email, currentPassword);
    await api.reauthenticateWithCredential(current, cred);
  };

  const closeAccountPrompt = useCallback(() => {
    if (promptTimerRef.current) {
      clearTimeout(promptTimerRef.current);
      promptTimerRef.current = null;
    }
    pendingActionRef.current = null;
    pendingActionKindRef.current = null;
    setAccountPrompt(emptyPrompt());
    track('auth_required_dismissed');
  }, []);

  const registerSheetDismisser = useCallback((fn: (() => void) | null) => {
    dismissSheetsRef.current = fn;
  }, []);

  const clearCompletedAction = useCallback(() => setCompletedAction(null), []);

  const requireAccount = useCallback(
    (action: AccountAction, onReady: () => void): boolean => {
      const current = auth?.currentUser ?? user;
      if (current && !current.isAnonymous) {
        onReady();
        return true;
      }
      // Sheets are no longer native Modals (they portal to SheetHost), so
      // stacking Auth on top is safe. Closing everything first is what made
      // Save/Notify on a station look like a freeze: the hub vanished, then
      // a leftover backdrop still ate every tap.
      pendingActionRef.current = onReady;
      pendingActionKindRef.current = action;
      track('auth_required_for_action', { action });
      if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
      promptTimerRef.current = setTimeout(() => {
        promptTimerRef.current = null;
        setAccountPrompt({
          open: true,
          mode: 'signup',
          action,
          reason: ACTION_REASON_BY_ACTION[action] ?? ACTION_REASON,
        });
      }, SHEET_DISMISS_MS);
      return false;
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      hasAccount: Boolean(user && !user.isAnonymous),
      accountPrompt,
      closeAccountPrompt,
      requireAccount,
      registerSheetDismisser,
      completedAction,
      clearCompletedAction,
      login: async (email, password, waitlist) => {
        const { a, api } = requireAuth();
        // Leaving anonymous browse for an existing account.
        if (a.currentUser?.isAnonymous) {
          await api.signOut(a);
        }
        const cred = await api.signInWithEmailAndPassword(a, email, password);
        // Signed in. Bookkeeping below must never fail the sign-in.
        await settleAfterSignIn('email_signin', [
          () => identifyFirebaseUser(cred.user),
          () => track('auth_sign_in_succeeded'),
          async () => {
            const granted = await applyWaitlistOnAuth({
          accountEmail: cred.user.email,
          waitlistEmail: waitlist?.waitlistEmail,
          claimToken: waitlist?.claimToken,
          source: 'email_signin',
            });
            if (granted) {
              const { presentPremiumUnlock } = await import('@/services/subscription');
              presentPremiumUnlock({ kind: 'waitlist', trialStarted: true });
            }
          },
          () => syncPremiumEntitlement(),
          // Existing account signing in: backfill the server fields, no welcome.
          () => registerAccount({ isNewAccount: false }),
        ]);
      },
      loginWithApple: async (waitlist) => {
        const { a, api } = requireAuth();
        if (Platform.OS !== 'ios') {
          throw new AuthMessageError('Sign in with Apple is available on iPhone only.');
        }
        const isAvailable = await AppleAuthentication.isAvailableAsync();
        if (!isAvailable) {
          throw new AuthMessageError(
            'Apple sign-in is not available on this install. Use email, or open the TestFlight build.',
          );
        }
        // Nonce binds Apple's token to this one sign-in attempt, so a captured
        // token cannot be replayed. Apple signs over the SHA-256 DIGEST and
        // Firebase re-hashes the RAW value to check it, so each side must get a
        // different one. Sending no nonce at all (the previous behaviour) left
        // the exchange unbound and is the flow Firebase is least forgiving of.
        // 32 random bytes as hex — the same shape as the known-working
        // native-Apple implementation in strimy-app. More entropy than a UUID
        // and no formatting characters to trip anything up.
        const nonceBytes = await Crypto.getRandomBytesAsync(32);
        const rawNonce = Array.from(nonceBytes, (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        const hashedNonce = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          rawNonce,
        );

        let appleCred: AppleAuthentication.AppleAuthenticationCredential;
        try {
          appleCred = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: hashedNonce,
          });
        } catch (e) {
          // Cancelling is a choice, not a fault — do not log it as a failure.
          if (!isUserCancelledAuth(e)) {
            reportAuthFailure('apple', 'apple_request', e);
          }
          throw e;
        }

        const identityToken = appleCred.identityToken;
        if (!identityToken) {
          reportAuthFailure(
            'apple',
            'apple_credential',
            new Error('Apple returned no identityToken'),
          );
          throw new AuthMessageError('Apple sign-in token missing. Please try again.');
        }
        const provider = new api.OAuthProvider('apple.com');
        const firebaseCredential = provider.credential({
          idToken: identityToken,
          rawNonce,
        });

        const codeOf = (e: unknown): string =>
          typeof e === 'object' && e !== null && 'code' in e
            ? String((e as { code: unknown }).code)
            : '';

        let nextUser: User;
        // Gates the welcome email. Upgrading an anonymous browse session is a
        // new account from our side even though the uid already existed.
        let appleIsNewAccount = false;
        try {
          if (a.currentUser?.isAnonymous) {
            try {
              // Browsing anonymously → upgrade that uid in place so saves and
              // alerts carry over instead of starting a second account.
              const linked = await withTimeout(
                api.linkWithCredential(a.currentUser, firebaseCredential),
                CREDENTIAL_EXCHANGE_MS,
              );
              nextUser = linked.user;
              appleIsNewAccount = true;
              track('auth_anonymous_upgraded', { provider: 'apple' });
            } catch (e) {
              const code = codeOf(e);
              if (
                code === 'auth/credential-already-in-use' ||
                code === 'auth/email-already-in-use' ||
                code === 'auth/provider-already-linked'
              ) {
                // They already have a DriveIQ account for this Apple ID — sign
                // into it rather than failing the tap.
                //
                // Signing out drops the anonymous session, so if the sign-in
                // that follows fails we would strand the app with NO user at
                // all — browse state gone and not signed in either. Put an
                // anonymous session back before surfacing the error so the app
                // is never left in that state.
                await api.signOut(a);
                try {
                  const signed = await withTimeout(
                    api.signInWithCredential(a, firebaseCredential),
                    CREDENTIAL_EXCHANGE_MS,
                  );
                  nextUser = signed.user;
                  // Reached only because the Apple ID already has an account.
                  appleIsNewAccount = false;
                } catch (retryError) {
                  await ensureAnonymousUser().catch(() => undefined);
                  throw retryError;
                }
              } else {
                throw e;
              }
            }
          } else {
            const signed = await withTimeout(
              api.signInWithCredential(a, firebaseCredential),
              CREDENTIAL_EXCHANGE_MS,
            );
            nextUser = signed.user;
            appleIsNewAccount = api.getAdditionalUserInfo(signed)?.isNewUser ?? false;
          }
        } catch (e) {
          // Apple already succeeded if we are here — this is Firebase refusing
          // the token. Tag the stage and dump the raw error so the cause is
          // never a guess again.
          const code = codeOf(e);
          reportAuthFailure('apple', 'firebase_exchange', e);

          if (e instanceof SignInTimeoutError) {
            throw new AuthMessageError(
              'Signing in with Apple timed out. Check your connection and try again, or use email.',
            );
          }
          if (code === 'auth/network-request-failed' || code === 'auth/timeout') {
            throw new AuthMessageError(
              'Could not reach the sign-in service. Check your connection and try again.',
            );
          }
          if (code === 'auth/operation-not-allowed') {
            // Apple is not enabled as a sign-in provider on the Firebase
            // project, so there is nothing for the token to authenticate
            // against. Only a Console change fixes this — no amount of
            // retrying, and nothing in the app, will.
            throw new AuthMessageError(
              __DEV__
                ? 'Firebase has Apple DISABLED as a sign-in provider (auth/operation-not-allowed). Fix: Firebase Console → project driveiq-app → Authentication → Sign-in method → Apple → Enable. Nothing in the app can work around this.'
                : 'Sign in with Apple is not switched on for DriveIQ yet. Use Google or email for now.',
            );
          }
          if (
            code === 'auth/invalid-credential' ||
            code === 'auth/missing-or-invalid-nonce' ||
            code === 'auth/internal-error'
          ) {
            // Apple handed us a valid token and Firebase refused it, so the
            // failure is on the Firebase side, not the device's.
            //
            // A NATIVE Sign in with Apple token carries aud = the app's bundle
            // id (driveiq.app). Firebase only accepts that audience if the
            // project knows about it — i.e. an iOS app registered with that
            // exact bundle id, plus the Apple provider enabled with its
            // Services ID / Team ID / key. If the project only has a Web app,
            // the audience is unrecognised and every native sign-in lands here.
            //
            // Retrying cannot help, so a dev build names the code and the check.
            throw new AuthMessageError(
              __DEV__
                ? `Firebase rejected the Apple token (${code}). It is aud=driveiq.app from the native flow — confirm an iOS app with bundle id driveiq.app exists in Firebase project driveiq-app and that Apple is enabled with its Services ID / Team ID / key.`
                : 'Could not finish Sign in with Apple. Please use Google or email for now.',
            );
          }
          throw e;
        }

        // Signed in. Everything below is bookkeeping and must not be able to
        // turn a successful sign-in into an error — see settleAfterSignIn.
        const signedInUser = nextUser;
        const fullName = [appleCred.fullName?.givenName, appleCred.fullName?.familyName]
          .filter(Boolean)
          .join(' ')
          .trim();
        await settleAfterSignIn('apple', [
          async () => {
            if (fullName && !signedInUser.displayName) {
              await api.updateProfile(signedInUser, { displayName: fullName });
            }
          },
          () =>
            identifyFirebaseUser({
              ...signedInUser,
              displayName: fullName || signedInUser.displayName,
            }),
          () => track('auth_sign_in_succeeded', { provider: 'apple' }),
          async () => {
            const granted = await applyWaitlistOnAuth({
              accountEmail: signedInUser.email,
              waitlistEmail: waitlist?.waitlistEmail,
              claimToken: waitlist?.claimToken,
              source: 'apple_signin',
            });
            if (granted) {
              const { presentPremiumUnlock } = await import('@/services/subscription');
              presentPremiumUnlock({ kind: 'waitlist', trialStarted: true });
            }
          },
          () => syncPremiumEntitlement(),
          // Last: the updateProfile step above has already landed, so the
          // server sees Apple's fullName (given on first authorisation only).
          () => registerAccount({ isNewAccount: appleIsNewAccount }),
        ]);
      },
      loginWithGoogle: async (waitlist) => {
        const { a, api } = requireAuth();
        const idToken = await getGoogleSignInIdToken();
        const firebaseCredential = api.GoogleAuthProvider.credential(idToken);

        let nextUser: User;
        // Gates the welcome email — see the Apple path for why an upgrade counts.
        let googleIsNewAccount = false;
        if (a.currentUser?.isAnonymous) {
          try {
            const linked = await api.linkWithCredential(a.currentUser, firebaseCredential);
            nextUser = linked.user;
            googleIsNewAccount = true;
            track('auth_anonymous_upgraded', { provider: 'google' });
          } catch (e) {
            const code =
              typeof e === 'object' && e !== null && 'code' in e
                ? String((e as { code: unknown }).code)
                : '';
            if (
              code === 'auth/credential-already-in-use' ||
              code === 'auth/email-already-in-use'
            ) {
              await api.signOut(a);
              const signed = await api.signInWithCredential(a, firebaseCredential);
              nextUser = signed.user;
              // Reached only because the Google account already has one.
              googleIsNewAccount = false;
            } else {
              throw e;
            }
          }
        } else {
          const signed = await api.signInWithCredential(a, firebaseCredential);
          nextUser = signed.user;
          googleIsNewAccount = api.getAdditionalUserInfo(signed)?.isNewUser ?? false;
        }

        // Signed in. Bookkeeping below must never fail the sign-in.
        await settleAfterSignIn('google', [
          () => identifyFirebaseUser(nextUser),
          () => track('auth_sign_in_succeeded', { provider: 'google' }),
          async () => {
            const granted = await applyWaitlistOnAuth({
          accountEmail: nextUser.email,
          waitlistEmail: waitlist?.waitlistEmail,
          claimToken: waitlist?.claimToken,
          source: 'google_signin',
            });
            if (granted) {
              const { presentPremiumUnlock } = await import('@/services/subscription');
              presentPremiumUnlock({ kind: 'waitlist', trialStarted: true });
            }
          },
          () => syncPremiumEntitlement(),
          () => registerAccount({ isNewAccount: googleIsNewAccount }),
        ]);
      },
      signup: async (name, email, password, waitlist) => {
        const { a, api } = requireAuth();
        const trimmedEmail = email.trim();
        const trimmed = name.trim();
        const credential = api.EmailAuthProvider.credential(trimmedEmail, password);

        let nextUser: User;
        if (a.currentUser?.isAnonymous) {
          // Upgrade in place so the anonymous uid / history survives.
          try {
            const linked = await api.linkWithCredential(a.currentUser, credential);
            nextUser = linked.user;
            track('auth_anonymous_upgraded');
          } catch (e) {
            const code =
              typeof e === 'object' && e !== null && 'code' in e
                ? String((e as { code: unknown }).code)
                : '';
            // Email already belongs to another account — fall through to create
            // is wrong; surface the Firebase error. If link fails for other
            // reasons, try a normal create after signing out anonymous.
            if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use') {
              throw e;
            }
            await api.signOut(a);
            const created = await api.createUserWithEmailAndPassword(
              a,
              trimmedEmail,
              password,
            );
            nextUser = created.user;
          }
        } else {
          const created = await api.createUserWithEmailAndPassword(
            a,
            trimmedEmail,
            password,
          );
          nextUser = created.user;
        }

        if (trimmed) {
          await api.updateProfile(nextUser, { displayName: trimmed });
          setUser({ ...nextUser, displayName: trimmed } as User);
        } else {
          setUser(nextUser);
        }

        // Account created. Bookkeeping below must never fail the signup.
        let granted = false;
        await settleAfterSignIn('email_signup', [
          () =>
            identifyFirebaseUser({
              ...nextUser,
              displayName: trimmed || nextUser.displayName,
            }),
          () => {
            track('auth_sign_up_succeeded', { has_name: Boolean(trimmed) });
            track('signup_completed', { has_name: Boolean(trimmed) });
          },
          async () => {
            granted = await applyWaitlistOnAuth({
              accountEmail: nextUser.email ?? trimmedEmail,
              waitlistEmail: waitlist?.waitlistEmail,
              claimToken: waitlist?.claimToken,
              source: 'email_signup',
            });
            if (granted) {
              const { presentPremiumUnlock } = await import('@/services/subscription');
              presentPremiumUnlock({ kind: 'waitlist', trialStarted: true });
            }
          },
          () => syncPremiumEntitlement(),
          // After updateProfile above, so the welcome email can use the name.
          () => registerAccount({ isNewAccount: true }),
          async () => {
            const verificationSent = nextUser.emailVerified
              ? null
              : await sendVerifyLink(nextUser);
            if (!granted) {
              const { presentAccountReady } = await import('@/services/accountReady');
              presentAccountReady({
                name: trimmed,
                email: nextUser.email ?? trimmedEmail,
                verificationSent,
              });
            }
          },
        ]);
      },
      logout: async () => {
        const { a, api } = requireAuth();
        await clearPushTokenOnLogout();
        const { clearWaitlistCache } = await import('@/services/waitlist');
        await clearWaitlistCache();
        await api.signOut(a);
        track('auth_sign_out');
        // Return to anonymous browse mode.
        await ensureAnonymousUser();
      },
      sendReset: async (email) => {
        const { a, api } = requireAuth();
        await api.sendPasswordResetEmail(a, email);
        track('auth_password_reset_sent');
      },
      sendVerificationEmail: async () => {
        const { a } = requireAuth();
        if (!a.currentUser || a.currentUser.isAnonymous) return false;
        return sendVerifyLink(a.currentUser);
      },
      changePassword: async (currentPassword, newPassword) => {
        const { a, api } = requireAuth();
        await reauth(currentPassword);
        if (!a.currentUser) throw new Error('No authenticated user');
        await api.updatePassword(a.currentUser, newPassword);
        track('auth_password_changed');
      },
      updateDisplayName: async (name) => {
        const { a, api } = requireAuth();
        if (!a.currentUser) throw new Error('No authenticated user');
        await api.updateProfile(a.currentUser, { displayName: name.trim() });
        setUser({ ...a.currentUser });
        await refreshUserTraits({ $name: name.trim() });
        track('account_profile_updated');
      },
      updateUserEmail: async (currentPassword, newEmail) => {
        const { a, api } = requireAuth();
        await reauth(currentPassword);
        if (!a.currentUser) throw new Error('No authenticated user');
        await api.updateEmail(a.currentUser, newEmail.trim());
        setUser({ ...a.currentUser });
        await refreshUserTraits({
          $email: newEmail.trim(),
          email_verified: false,
        });
        track('account_email_updated');
      },
      deleteAccount: async () => {
        const { a, api } = requireAuth();
        if (!a.currentUser || a.currentUser.isAnonymous) {
          throw new Error('Sign in required to delete your account.');
        }
        const { requestAccountDeletion, clearAccountLocalData } = await import(
          '@/services/deleteAccount'
        );
        await clearPushTokenOnLogout();
        await requestAccountDeletion();
        const { clearWaitlistCache } = await import('@/services/waitlist');
        await clearWaitlistCache();
        await clearAccountLocalData();
        try {
          await api.signOut(a);
        } catch {
          /* Auth user may already be gone server-side */
        }
        track('auth_account_deleted');
        resetAnalyticsUser();
        await ensureAnonymousUser();
        await syncPremiumEntitlement();
      },
    }),
    [
      user,
      initializing,
      accountPrompt,
      closeAccountPrompt,
      requireAccount,
      registerSheetDismisser,
      completedAction,
      clearCompletedAction,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/**
 * Map raw Firebase Auth error codes to friendly, user-facing copy.
 */
/**
 * True when the user deliberately dismissed the provider's own sheet.
 *
 * A cancel is not an error — showing a red banner for "I changed my mind" is
 * just noise. Callers should clear their loading state and say nothing.
 */
export function isUserCancelledAuth(e: unknown): boolean {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : '';
  return (
    code === 'ERR_REQUEST_CANCELED' ||
    code === 'ERR_CANCELED' ||
    code === '-5' ||
    code === 'SIGN_IN_CANCELLED' ||
    code === '12501' ||
    message.includes('ERR_REQUEST_CANCELED') ||
    message.includes('ERR_CANCELED')
  );
}

export function friendlyAuthError(e: unknown): string {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : '';
  // Copy we wrote ourselves is already the best sentence available.
  if (isUserFacing(e)) return e.message;
  if (isUserCancelledAuth(e)) {
    return 'Sign-in was cancelled.';
  }
  if (
    message.includes('Expo Go') ||
    message.includes('Apple sign-in is not available') ||
    message.includes('TestFlight build')
  ) {
    return message;
  }
  if (code === 'auth/unavailable' || message === 'auth/unavailable') {
    return 'Sign-in is temporarily unavailable. Please try again later.';
  }
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/weak-password':
      return 'Password should be at least 8 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again in a little while.';
    case 'auth/requires-recent-login':
      return 'Please sign in again to make this change.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
