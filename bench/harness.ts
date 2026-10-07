/* eslint-disable */
/**
 * Timing, reporting and opt-in CPU profiling shared by the *.bench.tsx files.
 *
 * Environment variables:
 * - BENCH_RUNS / BENCH_WARMUP: timed and warmup iterations (default 10 / 3)
 * - BENCH_PROFILE: a directory; when set, each suite records an extra pass of
 *   its headline scenario under the V8 profiler and writes a .cpuprofile there.
 *   Profiling runs separately from the timed runs so it never skews them.
 * - NODE_ENV=production: run against production React builds (see
 *   .config/bench.jest.config.cjs). Dev React adds substantial overhead of
 *   its own, which understates how much of the cost is the library's.
 */
import { writeFileSync } from "fs";
import { Session } from "inspector";
import { join } from "path";

import * as TestRenderer from "react-test-renderer";

export const MODE =
  process.env.NODE_ENV === "production" ? "production" : "development";

/**
 * Production React does not export act(). In production mode the bench config
 * maps `scheduler` to the mock scheduler, so flushing it commits renders and
 * runs effects synchronously instead.
 */
const Scheduler = (TestRenderer as any)._Scheduler;
export const act: (fn: () => void) => void =
  (TestRenderer as any).act ??
  ((fn: () => void) => {
    fn();
    Scheduler.unstable_flushAllWithoutAsserting();
  });

if (MODE === "development") {
  // Tell React this environment supports act(), as Testing Library does.
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
}

export const create = TestRenderer.create;
export type Renderer = TestRenderer.ReactTestRenderer;

export const RUNS = Number(process.env.BENCH_RUNS ?? 10);
export const WARMUP_RUNS = Number(process.env.BENCH_WARMUP ?? 3);
export const PROFILE_DIR = process.env.BENCH_PROFILE;

export interface Stats {
  runs: number[];
  min: number;
  median: number;
  mean: number;
  max: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Milliseconds from a high-resolution clock. React Native's jest setup
 * replaces performance.now() with a millisecond-resolution clock, which is too
 * coarse for short scenarios.
 */
const now = () => Number(process.hrtime.bigint()) / 1e6;

export function measure(fn: () => void, runs = RUNS, warmup = WARMUP_RUNS) {
  for (let i = 0; i < warmup; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
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
  // One JSON line per scenario so results are easy to grep and diff.
  console.log(
    `BENCH ${JSON.stringify({ lib, mode: MODE, scenario, ...stats, ...extra })}`,
  );
}

export async function profile(name: string, fn: () => void) {
  if (!PROFILE_DIR) return;
  const session = new Session();
  session.connect();
  const post = (method: string, params?: object) =>
    new Promise<any>((resolve, reject) =>
      session.post(method, params, (err, res) =>
        err ? reject(err) : resolve(res),
      ),
    );
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 100 });
  await post("Profiler.start");
  fn();
  const { profile } = await post("Profiler.stop");
  session.disconnect();
  const path = join(PROFILE_DIR, `${name}-${MODE}.cpuprofile`);
  writeFileSync(path, JSON.stringify(profile));
  console.log(`BENCH profile written to ${path}`);
}
