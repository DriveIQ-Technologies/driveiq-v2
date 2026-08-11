/**
 * Auth context for DriveIQ.
 *
 * Thin, typed wrapper over Firebase Auth (email/password) exposing the
 * operations the UI needs: sign in, sign up (with display name), sign out,
 * password reset, change password (with re-auth), and profile/email edits.
 *
 * Auth is OPTIONAL in DriveIQ — the map is fully usable signed-out. The
 * sidebar surfaces sign-in and, once authenticated, account management.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Type-only import — erased at build time, so it does NOT pull the firebase
// runtime in here. All actual calls go through the lazily-loaded `authApi`.
import type { User } from 'firebase/auth';

import {
  identifyFirebaseUser,
  refreshUserTraits,
  resetAnalyticsUser,
  track,
} from '@/services/analytics';
import { auth, authApi } from '@/services/firebase';

export interface AuthContextValue {
  /** The current Firebase user, or null when signed out. */
  user: User | null;
  /** True until the first auth-state callback resolves (avoids UI flash). */
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  /** Re-authenticates with the current password, then sets a new one. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  /** Re-authenticates with the current password, then updates the email. */
  updateUserEmail: (currentPassword: string, newEmail: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LAST_EMAIL_KEY = 'diq:lastEmail';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // If Firebase failed to initialise, don't subscribe — just finish the
    // initial loading state so the UI renders (signed-out, auth disabled).
    if (!auth || !authApi) {
      setInitializing(false);
      return;
    }
    const unsub = authApi.onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await identifyFirebaseUser(u);
        track('auth_state_changed', { signed_in: true });
      } else {
        resetAnalyticsUser();
        track('auth_state_changed', { signed_in: false });
      }
      if (u?.email) {
        try {
          await AsyncStorage.setItem(LAST_EMAIL_KEY, u.email);
        } catch {
          /* non-fatal */
        }
      }
      setInitializing(false);
    });
    return unsub;
  }, []);

  /** Guard used by every auth action so a null Firebase surfaces a friendly
   *  error instead of throwing a TypeError. Returns the live auth + api. */
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

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      login: async (email, password) => {
        const { a, api } = requireAuth();
        const cred = await api.signInWithEmailAndPassword(a, email, password);
        await identifyFirebaseUser(cred.user);
        track('auth_sign_in_succeeded');
      },
      signup: async (name, email, password) => {
        const { a, api } = requireAuth();
        const cred = await api.createUserWithEmailAndPassword(a, email, password);
        const trimmed = name.trim();
        if (trimmed) {
          await api.updateProfile(cred.user, { displayName: trimmed });
          setUser({ ...cred.user });
        }
        // Identify immediately with the name we just set (auth listener also runs).
        await identifyFirebaseUser({
          ...cred.user,
          displayName: trimmed || cred.user.displayName,
        });
        track('auth_sign_up_succeeded', { has_name: Boolean(trimmed) });
      },
      logout: async () => {
        const { a, api } = requireAuth();
        await api.signOut(a);
        track('auth_sign_out');
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
    [user, initializing],
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
 * Used by the auth sheets so users see "Wrong password" not
 * "auth/invalid-credential".
 */
export function friendlyAuthError(e: unknown): string {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';
  // Our own sentinel for "Firebase didn't initialise".
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
