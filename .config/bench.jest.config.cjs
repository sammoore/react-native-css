/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

/**
 * Jest config for the benchmarks in src/bench (*.bench.tsx). The default
 * testMatch only picks up .test/.spec files, so `yarn test` never runs them.
 *
 * Benchmarks don't exercise reanimated, so this skips the reanimated/worklets
 * global setup used by the regular test suite.
 *
 * When BENCH_NW4_INTEROP points at an installed react-native-css-interop, it
 * is mapped in for nw4.bench.tsx, and react, react-native and scheduler are
 * pinned to this package's copies. Without the pinning, a copy of the interop
 * installed elsewhere (e.g. another workspace) can resolve its own React,
 * which breaks hooks, or a different react-native, which skews results.
 */
const path = require("path");

const jestExpo = require("jest-expo/jest-preset");

const rootDir = path.resolve(__dirname, "..");
const resolveDir = (id, from = rootDir) =>
  path.dirname(require.resolve(`${id}/package.json`, { paths: [from] }));

const interopDir = process.env.BENCH_NW4_INTEROP
  ? path.resolve(process.env.BENCH_NW4_INTEROP)
  : undefined;

let moduleNameMapper = jestExpo.moduleNameMapper;
if (interopDir) {
  const reactDir = resolveDir("react");
  const reactNativeDir = resolveDir("react-native");
  moduleNameMapper = {
    ...moduleNameMapper,
    "^react$": reactDir,
    "^react/(.*)$": `${reactDir}/$1`,
    "^react-native$": reactNativeDir,
    "^react-native/(.*)$": `${reactNativeDir}/$1`,
    "^scheduler$": resolveDir("scheduler", reactDir),
    "^react-native-css-interop$": interopDir,
    "^react-native-css-interop/(.*)$": `${interopDir}/$1`,
  };
}

module.exports = {
  ...jestExpo,
  rootDir,
  roots: ["<rootDir>/src/bench"],
  testMatch: ["**/*.bench.tsx"],
  testPathIgnorePatterns: ["dist/"],
  // Run suites one at a time so nw4 and nw5 don't compete for CPU.
  maxWorkers: 1,
  moduleNameMapper,
};
