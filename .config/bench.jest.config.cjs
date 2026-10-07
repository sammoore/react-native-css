/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

// Benchmarks don't exercise reanimated, so skip the (currently broken)
// reanimated/worklets global setup used by the regular test suite.
const jestExpo = require("jest-expo/jest-preset");

module.exports = {
  ...jestExpo,
  testPathIgnorePatterns: ["dist/", ".*/_[a-zA-Z]"],
};
