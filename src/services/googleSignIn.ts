import { Platform } from 'react-native';
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

let configured = false;

/** True when Firebase Google OAuth web client id is present in env. */
export function isGoogleSignInConfigured(): boolean {
  return Boolean(WEB_CLIENT_ID);
}

export function configureGoogleSignIn(): void {
  if (configured || !WEB_CLIENT_ID) return;
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID || undefined,
    offlineAccess: false,
  });
  configured = true;
}

/** Returns a Google ID token suitable for Firebase `GoogleAuthProvider.credential`. */
export async function getGoogleSignInIdToken(): Promise<string> {
  configureGoogleSignIn();
  if (!WEB_CLIENT_ID) {
    throw new Error(
      'Google sign-in is not configured. Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and rebuild the app.',
    );
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
  if (message.includes('not configured')) return message;
  if (message) return message;
  return 'Google sign-in failed. Please try again.';
}
