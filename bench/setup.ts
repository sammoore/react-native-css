/**
 * Runs after the React Native and Expo jest setup files.
 *
 * React Native's jest setup always defines __DEV__ as true. In production mode
 * that would leave React Native's own JavaScript, and any library that checks
 * __DEV__, on their development code paths while React itself runs its
 * production build, so match __DEV__ to NODE_ENV.
 */
if (process.env.NODE_ENV === "production") {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
}
