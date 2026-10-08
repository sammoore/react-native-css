/**
 * Jest reporter that prints the benchmark summary once the whole run has
 * finished, instead of a line per scenario as it goes.
 *
 * Under `yarn bench`, bench/run.cjs owns the results file and prints one
 * summary covering both React modes, so this reporter stays quiet.
 */
const fs = require("fs");

const { formatSummary, readResults } = require("./summary.cjs");

class BenchSummaryReporter {
  /**
   * @param {unknown} _globalConfig
   * @param {{ resultsFile: string, owner: boolean, summary: boolean }} options
   */
  constructor(_globalConfig, options) {
    this.options = options;
  }

  onRunStart() {
    if (this.options.owner)
      fs.rmSync(this.options.resultsFile, { force: true });
  }

  onRunComplete() {
    const { resultsFile, owner, summary } = this.options;
    if (!owner) return;
    if (summary) {
      process.stdout.write(
        formatSummary(readResults(resultsFile), {
          color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
        }),
      );
    }
    fs.rmSync(resultsFile, { force: true });
  }
}

module.exports = BenchSummaryReporter;
