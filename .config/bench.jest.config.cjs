/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

/**
 * Jest config for the benchmarks in bench/ (*.bench.tsx). The default
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
 *
 * With NODE_ENV=production, React's production builds are used. Production
 * React has no act(), so `scheduler` is mapped to the mock scheduler, which
 * bench/harness.ts flushes to commit renders synchronously. The Metro
 * override guard (which throws outside NODE_ENV=test) is mapped to the empty
 * module Metro substitutes in real apps.
 */
const os = require("os");
const path = require("path");

const jestExpo = require("jest-expo/jest-preset");

const rootDir = path.resolve(__dirname, "..");
const resolveDir = (id, from = rootDir) =>
  path.dirname(require.resolve(`${id}/package.json`, { paths: [from] }));

const interopDir = process.env.BENCH_NW4_INTEROP
  ? path.resolve(process.env.BENCH_NW4_INTEROP)
  : undefined;

const production = process.env.NODE_ENV === "production";
const reactDir = resolveDir("react");
const schedulerDir = resolveDir("scheduler", reactDir);

let moduleNameMapper = { ...jestExpo.moduleNameMapper };
if (interopDir) {
  const reactNativeDir = resolveDir("react-native");
  moduleNameMapper = {
    ...moduleNameMapper,
    "^react$": reactDir,
    "^react/(.*)$": `${reactDir}/$1`,
    "^react-native$": reactNativeDir,
    "^react-native/(.*)$": `${reactNativeDir}/$1`,
    "^scheduler$": schedulerDir,
    "^react-native-css-interop$": interopDir,
    "^react-native-css-interop/(.*)$": `${interopDir}/$1`,
  };
}
if (production) {
  moduleNameMapper = {
    ...moduleNameMapper,
    "^scheduler$": path.join(schedulerDir, "unstable_mock.js"),
    "react-native-css-metro-override$": "<rootDir>/src/metro/override.ts",
  };
}

// Results are collected in a file and summarized when the run finishes (see
// bench/summary.cjs). `yarn bench` (bench/run.cjs) provides its own file and
// prints one summary for both React modes; otherwise this run owns the file
// and its reporter prints the summary. Test workers inherit these variables.
const ownsResults = !process.env.BENCH_RESULTS_FILE;
process.env.BENCH_RESULTS_FILE ??= path.join(
  os.tmpdir(),
  `react-native-css-bench-${process.pid}.jsonl`,
);
const { shouldSummarize } = require("../bench/summary.cjs");
const summary = shouldSummarize(process.env, process.stdout);
process.env.BENCH_SUMMARY = summary ? "1" : "0";

module.exports = {
  ...jestExpo,
  rootDir,
  roots: ["<rootDir>/bench"],
  testMatch: ["**/*.bench.tsx"],
  testPathIgnorePatterns: ["dist/"],
  // Run suites one at a time so nw4 and nw5 don't compete for CPU.
  maxWorkers: 1,
  moduleNameMapper,
  reporters: [
    "default",
    [
      "<rootDir>/bench/reporter.cjs",
      {
        resultsFile: process.env.BENCH_RESULTS_FILE,
        owner: ownsResults,
        summary,
      },
    ],
  ],
};
