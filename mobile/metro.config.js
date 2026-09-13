const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Sentry's Metro config injects stable debug IDs into release bundles so
// uploaded source maps can be matched to the exact JavaScript bundle. Runtime
// Sentry.init() alone does not provide this build-time mapping.
const config = getSentryExpoConfig(__dirname);

module.exports = config;
