// Metro configuration for DriveIQ.
//
// The Firebase JS SDK ships ESM whose package "exports" map Metro's newer
// resolver (enabled by default in Expo SDK 53+) can mis-resolve in a React
// Native runtime, which surfaces as a hard crash on launch ("Component auth
// has not been registered yet"). The two lines below are Expo's documented
// fix: allow `.cjs` modules and fall back to the classic main-field
// resolution that picks Firebase's React Native–compatible build.
//
// See: https://docs.expo.dev/guides/using-firebase/
//
// PostHog's `@posthog/core` publishes subpath exports (`./surveys`,
// `./error-tracking`, …). With package-exports disabled for Firebase, Metro
// cannot resolve those bare subpaths, so we map them explicitly below.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = false;

const POSTHOG_CORE_SUBPATHS = {
  '@posthog/core/surveys': path.resolve(
    __dirname,
    'node_modules/@posthog/core/dist/surveys/index.js',
  ),
  '@posthog/core/error-tracking': path.resolve(
    __dirname,
    'node_modules/@posthog/core/dist/error-tracking/index.js',
  ),
  '@posthog/core/utils': path.resolve(
    __dirname,
    'node_modules/@posthog/core/dist/utils/index.js',
  ),
  '@posthog/core/testing': path.resolve(
    __dirname,
    'node_modules/@posthog/core/dist/testing/index.js',
  ),
};

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const mapped = POSTHOG_CORE_SUBPATHS[moduleName];
  if (mapped) {
    return { type: 'sourceFile', filePath: mapped };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
