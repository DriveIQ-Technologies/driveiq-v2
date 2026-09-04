import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';

type Extra = {
  googleWebClientId?: string;
  googleIosClientId?: string;
};

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

function webClientId(): string {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    extra().googleWebClientId ||
    ''
  ).trim();
}

function iosClientId(): string {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
    extra().googleIosClientId ||
    ''
  ).trim();
}

let configured = false;

/** True when Firebase Google OAuth web client id is present. */
export function isGoogleSignInConfigured(): boolean {
  return Boolean(webClientId());
}

export function configureGoogleSignIn(): void {
  const web = webClientId();
  if (configured || !web) return;
  GoogleSignin.configure({
    webClientId: web,
    iosClientId: iosClientId() || undefined,
    offlineAccess: false,
  });
  configured = true;
}

/** Returns a Google ID token suitable for Firebase `GoogleAuthProvider.credential`. */
export async function getGoogleSignInIdToken(): Promise<string> {
  configureGoogleSignIn();
  if (!webClientId()) {
    throw new Error('Google sign-in is not available in this build yet. Use email for now.');
  }
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }
  const response = await GoogleSignin.signIn();
  if (response.type === 'cancelled') {
    throw new Error('ERR_REQUEST_CANCELED');
  }
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google sign-in token missing. Please try again.');
  }
  return idToken;
}

export function friendlyGoogleSignInError(e: unknown): string {
  if (isErrorWithCode(e)) {
    if (e.code === statusCodes.SIGN_IN_CANCELLED) {
      return 'Google sign-in was cancelled.';
    }
    if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return 'Google Play Services is not available on this device.';
    }
    if (e.code === statusCodes.IN_PROGRESS) {
      return 'Google sign-in is already in progress.';
    }
  }
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : '';
  if (message.includes('ERR_REQUEST_CANCELED')) return 'Google sign-in was cancelled.';
  if (message.includes('not configured') || message.includes('not available in this build')) {
    return 'Google sign-in needs the next app update. Use email for now.';
  }
  if (message) return message;
  return 'Google sign-in failed. Please try again.';
}
