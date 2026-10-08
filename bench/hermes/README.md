# Running the suite on Hermes

The jest bench (`../README.md`) runs on Node's V8. This folder runs the same
suite, `../suite.tsx`, unchanged, as a plain script that Hermes can execute,
so results can be compared between the engines and between commits.

```bash
# 1. A Hermes CLI (one-time; see "Getting a Hermes CLI")
export HERMES=/path/to/hermes

# 2. Build bench.js (and bench.hbc, its Hermes bytecode), then run either
BENCH_GC=1 node bench/hermes/build.mjs
"$HERMES" bench/hermes/.build/bench.hbc            # Hermes
node --expose-gc bench/hermes/.build/bench.js     # V8

# Or compare two refs on both engines (builds, compiles and runs for you)
node bench/hermes/compare.mjs <base-ref> <head-ref> --rounds 4
```

The bench's variables work as under jest and are baked into the bundle at
build time: `NODE_ENV` (default `production` here), `BENCH_CSS`,
`BENCH_ITEMS`, `BENCH_RUNS`, `BENCH_WARMUP`, plus `BENCH_GC` (below).
`--filter <regexp>` limits the scenarios. Output is one `BENCH {...}` JSON
line per scenario, with an `engine` field.

### `BENCH_GC=1`: collect garbage before every timed run

Use it (`compare.mjs` does by default). Without it, comparisons between
commits are unreliable on both engines: the bundle allocates identically on
every run, so full collections land in the same scenarios' timed runs every
time, and a commit that shifts allocation slightly moves that cost from one
scenario to another. Repeat rounds don't average this out. In practice it
showed up as consistent 5–15% "wins" and "regressions" in scenarios a commit
doesn't touch. With a collection before each timed run, each run pays only
for the garbage it creates. Hermes' CLI has a global `gc()`; Node needs
`--expose-gc`.

## How the bundle is made (`build.mjs`)

1. **Build step, in Node.** The stylesheet is built with `../stylesheets.ts`
   and compiled with the compiler under test. The compiler uses lightningcss,
   a native addon, so it can't run on Hermes, and it is bundler work that the
   bench never times anyway. The JSON goes into the bundle, and
   `StyleCollection.inject` runs on the engine, as in an app.
2. **Bundle, with esbuild.** `entry.ts` + `../suite.tsx`, with the suite's
   `./harness`, `./libraries` and `./stylesheets` redirected to the stand-ins
   in this folder, `react-native` replaced by `react-native.tsx`, React's
   production builds and `react-test-renderer` (production React has no
   `act()`, so the mock scheduler is flushed, as the jest config does).
3. **Babel, with React Native's preset** and the `hermes-stable` transform
   profile, so the engine sees the code shapes a release build ships:
   `let`/`const` and destructuring lowered, `async` as generators, classes,
   spread and `for…of` left native.
4. **hermesc -O** (the one React Native ships, in `hermes-compiler`), as a
   release build compiles the bundle, into `bench.hbc` next to `bench.js`.
   `HERMESC` overrides the compiler; `--no-hbc` skips this step.

`--src <dir>` points `react-native-css` at another `src/` directory;
`compare.mjs` uses it to build each ref with `git archive`, then runs the two
bundles alternately and pools every timed run before taking the median.

## Differences from the jest bench

- **Only NativeWind v5.** v4 and Uniwind aren't wired up.
- **No React Native.** `react-native.tsx` renders host components the way
  React Native's jest mocks do. Its `Pressable` is simplified, so the
  `active:` scenario costs less than under jest; the same for every commit
  and engine.
- **No call counters or profiles.** For Hermes profiles, use the sampling
  profiler in a release app.
- **Same process for every scenario**, as in jest: the heap a scenario
  leaves behind affects the next.

## Getting a Hermes CLI

React Native 0.86 runs Hermes V1 (`sdks/.hermesv1version`, currently
`250829098.0.17`) unless `RCT_HERMES_V1_ENABLED=0`. npm only ships its
compiler (`hermesc`), not the VM, so build the VM from the same tag:

```bash
git clone --depth 1 --branch hermes-v250829098.0.17 https://github.com/facebook/hermes.git
# Optional, for sub-millisecond timing (below)
git -C hermes apply "$PWD/react-native-css/bench/hermes/hermes-performance-now.patch"
cmake -S hermes -B hermes-build -G Ninja -DCMAKE_BUILD_TYPE=Release   # needs ICU (libicu-dev on Linux)
ninja -C hermes-build hermes
export HERMES=$PWD/hermes-build/bin/hermes
```

The CLI has no clock finer than `Date.now()`. The patch adds a global
`performanceNow()` (`steady_clock`, in ms), which `globals.ts` installs as
`performance.now()`, the clock React Native provides in apps. Without it the
harness falls back to `Date.now()`, which is fine for the suite's
tens-of-milliseconds scenarios but not for short ones. The first line of
output names the clock in use.

The bytecode version of `$HERMES` must match the `hermesc` used to compile
(`hermes --version` and `hermesc --version` print it).

## Reading the results

Use these results to compare commits, and to see which changes help Hermes
more or less than V8, not for absolute numbers: this runs Hermes' bytecode
interpreter on a desktop CPU.
For absolute numbers, measure a release build on a device.
