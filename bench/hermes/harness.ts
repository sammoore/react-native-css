/* eslint-disable */
/**
 * Stands in for ../harness.ts when the suite runs as a plain script (see
 * README.md). Same exports and timing loop; differences:
 *
 * - The clock is whatever high-resolution timer the engine has (see now()).
 * - Results are printed as `BENCH {...}` JSON lines labelled with the engine,
 *   instead of being written to BENCH_RESULTS_FILE.
 * - profile() is a no-op: on Hermes, profile with the sampling profiler in a
 *   real app instead.
 * - With BENCH_GC=1, a full garbage collection runs (untimed) before every
 *   timed run; see collectGarbage().
 */
import * as TestRenderer from "react-test-renderer";

declare const HermesInternal: unknown;

export const ENGINE =
  typeof HermesInternal !== "undefined"
    ? "hermes"
    : typeof (globalThis as any).process?.versions?.v8 === "string"
      ? "v8"
      : "unknown";

export const MODE =
  process.env.NODE_ENV === "production" ? "production" : "development";

const Scheduler = (TestRenderer as any)._Scheduler;
export const act: (fn: () => void) => void =
  (TestRenderer as any).act ??
  ((fn: () => void) => {
    fn();
    Scheduler.unstable_flushAllWithoutAsserting();
  });

if (MODE === "development") {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
}

export const create = TestRenderer.create;
export type Renderer = TestRenderer.ReactTestRenderer;

export const RUNS = Number(process.env.BENCH_RUNS ?? 10);
export const WARMUP_RUNS = Number(process.env.BENCH_WARMUP ?? 3);
export const PROFILE_DIR = undefined;

/**
 * Whether to collect garbage before every timed run (BENCH_GC=1). The Hermes
 * CLI has a global gc(); Node needs --expose-gc.
 *
 * Without it, results are skewed by where full collections happen to land:
 * the bundle allocates the same way every time it runs, so a collection lands
 * in the same scenario's timed runs every time, and a commit that shifts
 * allocation slightly can move that cost from one scenario to another. Repeat
 * rounds don't average that out. Starting each timed run on a collected heap
 * leaves each run paying for the garbage it makes itself.
 */
export const GC = process.env.BENCH_GC === "1";
const gc = (globalThis as any).gc as (() => void) | undefined;
if (GC && typeof gc !== "function") {
  const message = "BENCH_GC=1 needs gc(): run Node with --expose-gc";
  const g = globalThis as any;
  if (typeof g.process?.exit !== "function") throw new Error(message);
  console.error(message);
  g.process.exit(1);
}
const collectGarbage = () => {
  if (GC) gc!();
};

export interface Stats {
  runs: number[];
  min: number;
  median: number;
  mean: number;
  max: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Milliseconds from the best clock available: Node's hrtime, then
 * performance.now() (see globals.ts), then Date.now(), which is only
 * millisecond-resolution.
 */
export const CLOCK = (() => {
  const g = globalThis as any;
  if (typeof g.process?.hrtime?.bigint === "function") {
    return {
      name: "hrtime",
      now: () => Number(g.process.hrtime.bigint()) / 1e6,
    };
  }
  if (typeof g.performance?.now === "function") {
    return { name: "performance.now", now: () => g.performance.now() };
  }
  return { name: "Date.now", now: () => Date.now() };
})();
const now = CLOCK.now;

export function measure(
  fn: () => void,
  runs = RUNS,
  warmup = WARMUP_RUNS,
  prepare?: () => void,
) {
  for (let i = 0; i < warmup; i++) {
    prepare?.();
    fn();
  }
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    prepare?.();
    collectGarbage();
    const start = now();
    fn();
    times.push(now() - start);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    runs: times.map(round),
    min: round(sorted[0] ?? NaN),
    median: round(sorted[Math.floor(sorted.length / 2)] ?? NaN),
    mean: round(times.reduce((a, b) => a + b, 0) / times.length),
    max: round(sorted[sorted.length - 1] ?? NaN),
  } satisfies Stats;
}

export function report(
  lib: string,
  scenario: string,
  stats: Stats,
  extra?: Record<string, unknown>,
) {
  record({ lib, scenario, ...stats, ...extra });
}

export function reportSkipped(lib: string, reason: string) {
  record({ lib, skipped: reason });
}

function record(fields: Record<string, unknown>) {
  const result = {
    engine: ENGINE,
    gc: GC,
    file: expect.getState().testPath ?? "",
    mode: MODE,
    ...fields,
  };
  console.log(`BENCH ${JSON.stringify(result)}`);
}

export async function profile(_name: string, _fn: () => void) {}
