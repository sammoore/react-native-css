/* eslint-disable */
/**
 * Compare the suite between two git refs, on Hermes and on V8, with the same
 * bench code. See README.md.
 *
 *   HERMES=/path/to/hermes node bench/hermes/compare.mjs <base> <head> \
 *     [--rounds 4] [--engines hermes,v8] [--filter <re>]
 *
 * Each ref's src/ is exported with `git archive` and bundled with this
 * checkout's bench. Bundles run alternately (base, head, base, head, ...) so
 * drift in machine load affects both equally, and every timed run of every
 * round is pooled before taking the median.
 *
 * BENCH_GC defaults to 1 here: a full collection before every timed run, so
 * where collections land doesn't decide the result (see harness.ts).
 *
 * build.mjs compiles the bytecode with the hermesc React Native ships, as a
 * release build does. HERMES must be a Hermes CLI with the same bytecode
 * version; see README.md for building one.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rounds: { type: "string", default: "4" },
    engines: { type: "string", default: "hermes,v8" },
    filter: { type: "string", default: "" },
    json: { type: "boolean", default: false },
  },
});
const [baseRef, headRef] = positionals;
if (!baseRef || !headRef) {
  console.error("usage: compare.mjs <base-ref> <head-ref> [--rounds N]");
  process.exit(1);
}
const rounds = Number(args.rounds);
process.env.BENCH_GC ??= "1";
const engines = args.engines.split(",");

const hermes = process.env.HERMES;
if (engines.includes("hermes") && !hermes) {
  console.error("Set HERMES to a Hermes CLI binary (see README.md).");
  process.exit(1);
}

const git = (...a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();

function prepare(ref) {
  const sha = git("rev-parse", "--short", ref);
  const dir = join(here, ".build", "refs", sha);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("sh", ["-c", `git archive ${sha} src | tar -x -C "${dir}"`], {
    cwd: root,
  });
  const js = join(dir, "bench.js");
  execFileSync(
    process.execPath,
    [join(here, "build.mjs"), "--src", join(dir, "src"), "--out", js]
      .concat(args.filter ? ["--filter", args.filter] : [])
      .concat(engines.includes("hermes") ? [] : ["--no-hbc"]),
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return { ref, sha, js, hbc: join(dir, "bench.hbc") };
}

function run(engine, build) {
  const output =
    engine === "hermes"
      ? execFileSync(hermes, [build.hbc], {
          encoding: "utf8",
          maxBuffer: 1 << 26,
        })
      : execFileSync(process.execPath, ["--expose-gc", build.js], {
          encoding: "utf8",
          maxBuffer: 1 << 26,
        });
  const failures = output.split("\n").filter((l) => l.startsWith("FAIL"));
  if (failures.length) throw new Error(failures.join("\n"));
  return output
    .split("\n")
    .filter((line) => line.startsWith("BENCH "))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((r) => !r.skipped);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const builds = [prepare(baseRef), prepare(headRef)];
/** runs[engine][sha][scenario] = number[] */
const runs = {};
for (const engine of engines) {
  runs[engine] = {};
  for (const build of builds) runs[engine][build.sha] = {};
  for (let round = 0; round < rounds; round++) {
    // Alternate which goes first, so neither always runs on a cooler machine.
    const order = round % 2 ? [...builds].reverse() : builds;
    for (const build of order) {
      for (const result of run(engine, build)) {
        (runs[engine][build.sha][result.scenario] ??= []).push(...result.runs);
      }
    }
    process.stderr.write(`${engine}: round ${round + 1}/${rounds}\n`);
  }
}

const [base, head] = builds;
const scenarios = Object.keys(runs[engines[0]][base.sha]);
const table = scenarios.map((scenario) => {
  const row = { scenario };
  for (const engine of engines) {
    const a = median(runs[engine][base.sha][scenario]);
    const b = median(runs[engine][head.sha][scenario]);
    row[engine] = { base: a, head: b, change: b / a - 1 };
  }
  return row;
});

if (args.json) {
  console.log(JSON.stringify({ base, head, rounds, table }));
} else {
  const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const ms = (x) => x.toFixed(1).padStart(7);
  console.log(
    `\n${base.sha} (${base.ref}) → ${head.sha} (${head.ref}), ` +
      `median ms of ${rounds} rounds pooled\n`,
  );
  const header = ["scenario".padEnd(38)];
  for (const engine of engines) {
    header.push(
      `${engine} base`.padStart(12),
      "head".padStart(7),
      "Δ".padStart(8),
    );
  }
  console.log(header.join(" "));
  for (const row of table) {
    const cells = [row.scenario.padEnd(38)];
    for (const engine of engines) {
      const { base: a, head: b, change } = row[engine];
      cells.push(ms(a).padStart(12), ms(b), pct(change).padStart(8));
    }
    console.log(cells.join(" "));
  }
}
