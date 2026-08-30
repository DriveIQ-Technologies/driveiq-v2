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
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from 'firebase/auth';

import {
  identifyFirebaseUser,
  refreshUserTraits,
  resetAnalyticsUser,
  track,
} from '@/services/analytics';
import { auth, authApi } from '@/services/firebase';
import { applyWaitlistPremium } from '@/services/waitlist';
import { syncPremiumEntitlement } from '@/services/subscription';
import { identifyPurchasesUser } from '@/services/purchases';
import { registerPushToken, clearPushTokenOnLogout } from '@/services/pushTokens';

export type AccountAction =
  | 'save'
  | 'notify'
  | 'watched_flight'
  | 'ai_question'
  | 'add_to_calendar';

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
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  updateUserEmail: (currentPassword: string, newEmail: string) => Promise<void>;
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

async function ensureAnonymousUser(): Promise<void> {
  if (!auth || !authApi) return;
  if (auth.currentUser) return;
  try {
    await authApi.signInAnonymously(auth);
    track('auth_anonymous_started');
  } catch (e) {
    console.warn('[auth] anonymous sign-in failed', e);
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
          const { syncUserProfileFromLocal } = await import('@/services/userSync');
          await syncUserProfileFromLocal(
            await loadPrefs(),
            await loadLineSubscriptions(),
            Object.values(await loadSavedFlights()),
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
          console.warn('[auth] pending action failed', e);
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
      login: async (email, password) => {
        const { a, api } = requireAuth();
        // Leaving anonymous browse for an existing account.
        if (a.currentUser?.isAnonymous) {
          await api.signOut(a);
        }
        const cred = await api.signInWithEmailAndPassword(a, email, password);
        await identifyFirebaseUser(cred.user);
        track('auth_sign_in_succeeded');
        if (cred.user.email) {
          const granted = await applyWaitlistPremium(cred.user.email);
          if (granted) {
            const { presentPremiumUnlock } = await import('@/services/subscription');
            presentPremiumUnlock({ kind: 'waitlist', trialStarted: true });
          }
        }
        await syncPremiumEntitlement();
      },
      signup: async (name, email, password) => {
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

        await identifyFirebaseUser({
          ...nextUser,
          displayName: trimmed || nextUser.displayName,
        });
        track('auth_sign_up_succeeded', { has_name: Boolean(trimmed) });
        track('signup_completed', { has_name: Boolean(trimmed) });
        if (nextUser.email) {
          const granted = await applyWaitlistPremium(nextUser.email);
          if (granted) {
            const { presentPremiumUnlock } = await import('@/services/subscription');
            presentPremiumUnlock({ kind: 'waitlist', trialStarted: true });
          }
        }
        await syncPremiumEntitlement();

        try {
          const origin =
            process.env.EXPO_PUBLIC_AUTH_CONTINUE_URL ?? 'https://driveiq.app';
          await api.sendEmailVerification(nextUser, {
            url: origin,
            handleCodeInApp: false,
          });
          track('auth_verification_email_sent');
        } catch (e) {
          console.warn('[auth] verification email failed', e);
          track('auth_verification_email_failed');
        }
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
export function friendlyAuthError(e: unknown): string {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : '';
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
      return 'Password should be at least 6 characters.';
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
