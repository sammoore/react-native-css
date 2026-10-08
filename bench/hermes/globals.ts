/* eslint-disable */
/**
 * Just enough of jest's globals (describe, test, beforeAll, expect) and of
 * Node's (process.env, console) for the shared suite to run as a plain script
 * on Hermes or Node. Tests are collected while the suite module evaluates and
 * run in order by `runCollected()`.
 *
 * Imported first by entry.ts, so these exist before the suite module runs.
 */
declare const print: ((...args: unknown[]) => void) | undefined;
declare const __BENCH_ENV__: Record<string, string>;

const g = globalThis as any;

// Hermes' CLI has print() but no console.
if (typeof g.console === "undefined" && typeof print === "function") {
  const log = (...args: unknown[]) =>
    print(
      args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" "),
    );
  g.console = { log, info: log, warn: log, error: log, debug: () => {} };
}

// React Native defines `global`, which React's packages use.
g.global ??= globalThis;

// The Hermes CLI patched as README.md describes exposes a high-resolution
// clock as performanceNow(); React Native apps have performance.now().
declare const performanceNow: (() => number) | undefined;
if (
  typeof g.performance?.now !== "function" &&
  typeof performanceNow === "function"
) {
  g.performance = { now: performanceNow };
}

// The bench reads its configuration from process.env. Under Node the real
// environment wins; on Hermes the values are baked in at bundle time.
if (typeof g.process === "undefined") {
  g.process = { env: {} };
}
g.process.env = { ...__BENCH_ENV__, ...g.process.env };
g.__DEV__ = g.process.env.NODE_ENV !== "production";

type Fn = () => void | Promise<void>;
interface Block {
  name: string;
  beforeAll: Fn[];
  tests: { name: string; fn: Fn }[];
  children: Block[];
}

const root: Block = { name: "", beforeAll: [], tests: [], children: [] };
let current = root;

g.describe = (name: string, fn: () => void) => {
  const block: Block = { name, beforeAll: [], tests: [], children: [] };
  current.children.push(block);
  const parent = current;
  current = block;
  fn();
  current = parent;
};
g.beforeAll = (fn: Fn) => current.beforeAll.push(fn);
g.test = g.it = (name: string, fn: Fn) => current.tests.push({ name, fn });
g.test.skip = g.it.skip = () => {};

let currentTestPath = "";
export const setTestPath = (path: string) => (currentTestPath = path);

/** Run everything collected so far, depth first, in definition order. */
export async function runCollected(filter?: RegExp) {
  const failures: string[] = [];
  const run = async (block: Block, path: string[]) => {
    for (const fn of block.beforeAll) await fn();
    for (const { name, fn } of block.tests) {
      const full = [...path, name].join(" › ");
      if (filter && !filter.test(full)) continue;
      try {
        await fn();
      } catch (error: any) {
        failures.push(full);
        console.log(`FAIL ${full}: ${error?.message ?? error}`);
      }
    }
    for (const child of block.children) {
      await run(child, [...path, child.name]);
    }
  };
  await run(root, []);
  return failures;
}

// expect(), only as far as the suite's style checks use it.
const ASYMMETRIC = Symbol("asymmetric");
function matches(expected: any, actual: any): boolean {
  if (expected && expected[ASYMMETRIC]) return expected.match(actual);
  if (Object.is(expected, actual)) return true;
  if (
    typeof expected !== "object" ||
    typeof actual !== "object" ||
    !expected ||
    !actual
  ) {
    return false;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    if (!matches(expected[key], actual[key])) return false;
  }
  return true;
}

function expect(actual: any) {
  const fail = (what: string, expected: unknown) => {
    throw new Error(
      `expected ${JSON.stringify(actual)} ${what} ${JSON.stringify(expected)}`,
    );
  };
  return {
    toContainEqual(expected: unknown) {
      if (!actual.some((item: unknown) => matches(expected, item))) {
        fail("to contain", expected);
      }
    },
    toEqual(expected: unknown) {
      if (!matches(expected, actual)) fail("to equal", expected);
    },
    toBe(expected: unknown) {
      if (!Object.is(expected, actual)) fail("to be", expected);
    },
  };
}
expect.objectContaining = (subset: Record<string, unknown>) => ({
  [ASYMMETRIC]: true,
  match: (actual: any) =>
    actual != null &&
    Object.keys(subset).every((key) => matches(subset[key], actual[key])),
  toJSON: () => ({ objectContaining: subset }),
});
expect.getState = () => ({ testPath: currentTestPath });
g.expect = expect;
