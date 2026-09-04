/**
 * Dynamic Expo config. Wraps app.json and injects the Google Maps API key
 * from the local `.env` file at build time.
 *
 * Expo CLI auto-loads `.env` into process.env (SDK 49+), so a plain
 * `process.env.GOOGLE_MAPS_API_KEY` is enough — no dotenv import required.
 *
 * `GOOGLE_MAPS_API_KEY` is a regular env var (no EXPO_PUBLIC_ prefix) so
 * it does NOT end up inlined in the JS bundle. It only flows into the
 * native iOS / Android config used to register the Google Maps SDK.
 *
 * Both platforms get the key via the `react-native-maps` config plugin.
 * Passing only `iosGoogleMapsApiKey` causes the plugin to *remove* any
 * Android `com.google.android.geo.API_KEY` meta-data, which crashes the
 * map on launch. Keep the legacy `android.config.googleMaps.apiKey` too
 * for Expo's built-in GoogleMapsApiKey plugin.
 */

module.exports = ({ config }) => {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';
  // OAuth client IDs are public by design (shipped in the binary). Keep a
  // project fallback so EAS/TestFlight still gets Google Sign-In when .env
  // secrets were not copied into the build environment.
  const googleWebClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    '327546397871-6f48ag5kq5jq1gfh4dvhbe5fdv0ik9l2.apps.googleusercontent.com';
  const googleIosClientId =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || googleWebClientId;
  const googleIosUrlScheme =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ||
    (googleIosClientId
      ? `com.googleusercontent.apps.${googleIosClientId.replace(
          '.apps.googleusercontent.com',
          '',
        )}`
      : '');

  const plugins = [
    ...(config.plugins ?? []),
    [
      'react-native-maps',
      {
        iosGoogleMapsApiKey: googleMapsApiKey,
        androidGoogleMapsApiKey: googleMapsApiKey,
      },
    ],
  ];

  if (googleIosUrlScheme) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: googleIosUrlScheme },
    ]);
  }

  return {
    ...config,
    plugins,
    extra: {
      ...(config.extra ?? {}),
      googleWebClientId,
      googleIosClientId,
      googleIosUrlScheme,
    },
    android: {
      ...(config.android ?? {}),
      config: {
        ...((config.android && config.android.config) || {}),
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
    },
  };
};
