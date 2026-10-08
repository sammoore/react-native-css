/**
 * `yarn bench`: runs the benchmarks under development and then production
 * React, and prints one summary for both at the end. Extra arguments (e.g. a
 * file to run) are forwarded to both runs.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  formatSummary,
  readResults,
  shouldSummarize,
} = require("./summary.cjs");

const jest = require.resolve("jest/bin/jest");
const config = path.join(__dirname, "../.config/bench.jest.config.cjs");
const resultsFile = path.join(
  os.tmpdir(),
  `react-native-css-bench-${process.pid}.jsonl`,
);
const summary = shouldSummarize(process.env, process.stdout);

// Development React runs with NODE_ENV=test, as jest does by default.
let status = 0;
for (const nodeEnv of ["test", "production"]) {
  const run = spawnSync(
    process.execPath,
    [jest, "-c", config, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: nodeEnv,
        BENCH_RESULTS_FILE: resultsFile,
        BENCH_SUMMARY: summary ? "1" : "0",
      },
    },
  );
  status ||= run.status ?? 1;
}

if (summary) {
  process.stdout.write(
    formatSummary(readResults(resultsFile), {
      color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
    }),
  );
}
fs.rmSync(resultsFile, { force: true });
process.exit(status);
