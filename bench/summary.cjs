/**
 * Pretty end-of-run summaries for benchmark results.
 *
 * bench/harness.ts appends one JSON line per scenario to BENCH_RESULTS_FILE.
 * The jest reporter (bench/reporter.cjs) and the `yarn bench` runner
 * (bench/run.cjs) read that file and print formatSummary() once everything
 * has finished.
 *
 * Summaries are on when stdout is an interactive terminal. BENCH_SUMMARY=1
 * forces them on and BENCH_SUMMARY=0 off. When off, the harness prints a raw
 * `BENCH {...}` line per scenario instead, for piping and CI.
 */
const fs = require("fs");
const { stripVTControlCharacters } = require("util");

/** @typedef {Record<string, unknown> & { lib: string, mode: string, scenario: string, file: string, median: number, min: number, max: number, runs: number[], css?: string }} Result */

/** Fields every result has; anything else is shown as a note. */
const STAT_KEYS = new Set([
  "lib",
  "mode",
  "scenario",
  "file",
  "section",
  "css",
  "runs",
  "min",
  "median",
  "mean",
  "max",
]);

/**
 * Known libraries in display order. The first that ran is the baseline the
 * others are compared with; unknown libraries are listed after these.
 */
const LIBS = ["nw5", "nw4", "uniwind"];

/** The libraries in results, in display order. */
function librariesIn(results) {
  const present = [...new Set(results.map((r) => r.lib))];
  const rank = (lib) => (LIBS.includes(lib) ? LIBS.indexOf(lib) : LIBS.length);
  return present.sort((a, b) => rank(a) - rank(b));
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ isTTY?: boolean }} stdout
 */
function shouldSummarize(env, stdout) {
  if (env.BENCH_SUMMARY === "1") return true;
  if (env.BENCH_SUMMARY === "0") return false;
  return Boolean(stdout.isTTY);
}

/** @param {string} file @returns {Result[]} */
function readResults(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** @param {boolean} enabled */
function styles(enabled) {
  const wrap = (open, close) => (text) =>
    enabled ? `\x1b[${open}m${text}\x1b[${close}m` : text;
  return { bold: wrap(1, 22), dim: wrap(2, 22), cyan: wrap(36, 39) };
}

/** Milliseconds with precision that suits their size. */
function ms(value) {
  return value < 10 ? value.toFixed(2) : value.toFixed(1);
}

/** "median (min–max)", the timing shown for one result. */
function formatTiming(result, style) {
  return `${ms(result.median)} ${style.dim(`(${ms(result.min)}–${ms(result.max)})`)}`;
}

/** Counter suffixes the suite and benchmarks use, and how to show them. */
const COUNTER_SUFFIXES = [
  ["OnFirstRender", (value) => `${value} first render`],
  ["PerRun", (value) => `${value}/run`],
];

/**
 * Extra fields (counters, sizes) as short notes. Counters sharing a name are
 * combined: calculatePropsOnFirstRender 6 and calculatePropsPerRun 0 become
 * "calculateProps 6 first render, 0/run".
 */
function formatNotes(result) {
  const counters = new Map();
  const notes = [];
  for (const [key, value] of Object.entries(result)) {
    if (STAT_KEYS.has(key)) continue;
    const counter = COUNTER_SUFFIXES.find(([suffix]) => key.endsWith(suffix));
    if (!counter) {
      notes.push(`${key} ${String(value)}`);
      continue;
    }
    const [suffix, format] = counter;
    const name = key.slice(0, -suffix.length);
    if (!counters.has(name)) counters.set(name, []);
    counters.get(name).push(format(value));
  }
  for (const [name, parts] of counters)
    notes.push(`${name} ${parts.join(", ")}`);
  return notes.join("; ");
}

/**
 * Results that set a section (the suite, which spans one file per library)
 * share it; others are grouped by file. Either way, by stylesheet too.
 */
function sectionTitle(result) {
  const name =
    result.section ?? result.file.replace(/\.(bench|diag)\.tsx$/, "");
  return result.css ? `${name}, ${result.css} CSS` : name;
}

/** Group items by key, keeping first-seen order. */
function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const k = key(item);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return groups;
}

/** Visible length, ignoring ANSI escapes. */
const visibleLength = (text) => stripVTControlCharacters(text).length;

const pad = (text, width) =>
  text + " ".repeat(Math.max(0, width - visibleLength(text)));

/**
 * Format one section: a table with a row per scenario and a timing column per
 * library. When more than one library ran, a ratio column compares each with
 * the first (the baseline): below 1× means the baseline is faster.
 *
 * @param {string} title
 * @param {Result[]} results
 * @param {ReturnType<typeof styles>} style
 */
function formatSection(title, results, style) {
  const libs = librariesIn(results);
  const [baseline, ...others] = libs;
  const byScenario = groupBy(results, (r) => r.scenario);

  const header = [
    "",
    ...libs,
    ...others.map((lib) => `${baseline}/${lib}`),
    "notes",
  ];
  const rows = [...byScenario].map(([scenario, scenarioResults]) => {
    const forLib = (lib) => scenarioResults.find((r) => r.lib === lib);
    const ratio = (lib) =>
      forLib(baseline) && forLib(lib)
        ? `${(forLib(baseline).median / forLib(lib).median).toFixed(2)}×`
        : "";
    return [
      scenario,
      ...libs.map((lib) =>
        forLib(lib) ? formatTiming(forLib(lib), style) : "",
      ),
      ...others.map(ratio),
      style.dim(formatNotes(forLib(baseline) ?? scenarioResults[0])),
    ];
  });

  // The notes column is last and left unpadded.
  const widths = header.map((_, column) =>
    Math.max(
      ...[header, ...rows].map((row) => visibleLength(row[column] ?? "")),
    ),
  );
  const line = (row) =>
    "  " +
    row
      .map((cell, column) =>
        column === row.length - 1 ? cell : pad(cell, widths[column]),
      )
      .join("   ")
      .trimEnd();

  return [
    style.bold(title),
    line(header.map((cell) => style.dim(cell))),
    ...rows.map(line),
  ].join("\n");
}

/** One line per skipped library and reason, or "" when none were skipped. */
function formatSkipped(results, style) {
  const reasons = new Map();
  for (const r of results) {
    if (r.skipped) reasons.set(`${r.lib} (${r.skipped})`, true);
  }
  if (reasons.size === 0) return "";
  return style.dim(`Skipped: ${[...reasons.keys()].join("; ")}`);
}

/**
 * Format all results: one heading per React mode, then one section per
 * stylesheet or benchmark file.
 *
 * @param {Result[]} results
 * @param {{ color?: boolean }} [options]
 */
function formatSummary(results, { color = false } = {}) {
  if (results.length === 0) return "";
  const style = styles(color);
  const timed = results.filter((r) => !r.skipped);
  const runs = Math.max(0, ...timed.map((r) => r.runs.length));

  const modes = [...groupBy(results, (r) => r.mode)].map(
    ([mode, modeResults]) =>
      [
        style.cyan(
          style.bold(`${mode[0].toUpperCase()}${mode.slice(1)} React`),
        ),
        ...[
          ...groupBy(
            timed.filter((r) => r.mode === mode),
            sectionTitle,
          ),
        ].map(([title, section]) => formatSection(title, section, style)),
        formatSkipped(modeResults, style),
      ]
        .filter(Boolean)
        .join("\n\n"),
  );

  return [
    "",
    style.bold("Benchmark summary"),
    style.dim(`Median (min–max) in ms over ${runs} timed runs.`),
    "",
    modes.join("\n\n\n"),
    "",
  ].join("\n");
}

module.exports = { formatSummary, readResults, shouldSummarize };
