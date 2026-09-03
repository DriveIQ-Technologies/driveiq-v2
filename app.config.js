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
  const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ?? '';

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
