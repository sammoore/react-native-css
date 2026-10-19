# Benchmarking on Hermes

The jest bench (`bench/README.md`) runs on Node's V8. `bench/hermes/` runs
the same suite, `bench/suite.tsx`, unchanged, as a plain script on the Hermes
CLI or on Node, so you can compare engines and commits with identical code.

Use it to compare commits, and to see which changes help Hermes more or less
than V8. Don't use it for absolute numbers: it runs Hermes' bytecode
interpreter on a desktop CPU. For those, measure a release build on a device.

## Quick start

```bash
# One-time: a Hermes CLI (see "Getting a Hermes CLI")
export HERMES=/path/to/hermes-build/bin/hermes

# Compare two refs on both engines. Builds, compiles and runs everything.
node bench/hermes/compare.mjs <base-ref> <head-ref> --rounds 4

# Or build once and run it yourself
BENCH_GC=1 node bench/hermes/build.mjs
"$HERMES" bench/hermes/.build/bench.hbc            # Hermes
node --expose-gc bench/hermes/.build/bench.js     # V8
```

The first line of output names the engine, React mode, clock and whether GC
runs between timed runs, e.g.
`# engine=hermes mode=production clock=performance.now gc-between-runs=true`.
Check it before trusting a run. After that, each scenario prints one
`BENCH {...}` JSON line with an `engine` field.

## `BENCH_GC=1`: always use it when comparing commits

`BENCH_GC=1` runs a full garbage collection, untimed, before every timed run.
`compare.mjs` sets it by default. Set it yourself when you run `build.mjs`.

Without it, commit-to-commit comparisons are unreliable on both engines. The
bundle allocates exactly the same way every time it runs, so full
collections land in the same scenarios' timed runs on every run. A commit
that shifts allocation slightly moves that cost from one scenario to another,
and repeat rounds don't average it out because every round repeats the same
pattern. In practice this showed up as consistent 5–15% "wins" and
"regressions" in scenarios the commit doesn't touch. For example, 5896413
looked like a 9–13% Hermes win without it and was flat with it.

With a collection before each timed run, each run pays only for the garbage
it creates itself.

- Hermes' CLI has a global `gc()`, so nothing extra is needed.
- Node needs `--expose-gc`. Without it, a `BENCH_GC=1` bundle exits with
  `BENCH_GC=1 needs gc(): run Node with --expose-gc`. `compare.mjs` passes
  the flag for you.
- The value is baked in at build time, so rebuild after changing it.

## Settings

The `BENCH_*` variables and `NODE_ENV` are read by `build.mjs` and baked
into the bundle, so rebuild after changing them (`compare.mjs` rebuilds every
time). `HERMES` and `HERMESC` are read when the scripts run.

| Variable       | Default                    | Meaning                                                 |
| -------------- | -------------------------- | ------------------------------------------------------- |
| `BENCH_GC`     | `0` (`1` in `compare.mjs`) | Full GC before every timed run                          |
| `BENCH_RUNS`   | 10                         | Timed iterations per scenario                           |
| `BENCH_WARMUP` | 3                          | Untimed iterations before timing                        |
| `BENCH_ITEMS`  | 1000                       | Items per tree                                          |
| `BENCH_CSS`    | `plain`                    | `plain` or `tailwind`, as in the jest bench             |
| `NODE_ENV`     | `production`               | `development` uses React's development builds           |
| `HERMES`       | unset                      | Hermes CLI binary; required by `compare.mjs` for Hermes |
| `HERMESC`      | RN's hermesc               | Bytecode compiler used by `build.mjs`                   |

`build.mjs` options:

- `--filter <regexp>`: only run matching scenarios.
- `--src <dir>`: resolve `react-native-css` to another `src/` directory, to
  benchmark other code with this checkout's bench.
- `--out <file>`: where to write the bundle (default
  `bench/hermes/.build/bench.js`, with `bench.hbc` next to it).
- `--no-hbc`: skip compiling to Hermes bytecode (V8 only).

`compare.mjs` options:

- `--rounds N` (default 4): how many times to run each bundle. Bundles run
  alternately (base, head, head, base, …) so drift in machine load affects
  both. Every timed run of every round is pooled before taking the median.
- `--engines hermes,v8` (default both): `--engines v8` doesn't need `HERMES`.
- `--filter <regexp>`: only run matching scenarios.
- `--json`: print the table as JSON.

`compare.mjs` exports each ref's `src/` with `git archive` into
`bench/hermes/.build/refs/<sha>/`, so the bench code itself always comes from
your current checkout. With `BENCH_RUNS=12` and 4 rounds, one pair took about
15–20 minutes on a 2-core machine.

### Reading the comparison

- Differences under about ±8% are noise; for the small V8 scenarios, more.
- `remount, raw react-native` doesn't involve the library at all. Treat it as
  a control: if it moves, the run was noisy.
- Scenarios share one process, as under jest, so the heap a scenario leaves
  behind affects the next. A change that only shows up in later scenarios
  may come from state left by an earlier one; rerun with `--filter` to check.

## Getting a Hermes CLI

React Native 0.86 runs Hermes V1 (`sdks/.hermesv1version`, currently
`250829098.0.17`) unless `RCT_HERMES_V1_ENABLED=0`. npm ships only the
compiler (`hermesc`, in the `hermes-compiler` package), not the VM, so build
the VM from the same tag:

```bash
git clone --depth 1 --branch hermes-v250829098.0.17 https://github.com/facebook/hermes.git
# Optional but recommended: a sub-millisecond clock (below)
git -C hermes apply /path/to/react-native-css/bench/hermes/hermes-performance-now.patch
# On Linux this needs ICU (libicu-dev)
cmake -S hermes -B hermes-build -G Ninja -DCMAKE_BUILD_TYPE=Release
ninja -C hermes-build hermes
export HERMES=$PWD/hermes-build/bin/hermes
```

The build takes about 15 minutes on 2 cores.

- **Clock.** The CLI has no clock finer than `Date.now()`. The patch adds a
  global `performanceNow()` (`steady_clock`, in ms), which the harness
  installs as `performance.now()`, the clock React Native provides in apps.
  Without it the harness falls back to `Date.now()`. That's enough for the
  suite's tens-of-milliseconds scenarios, but not for short ones.
- **Bytecode version.** `$HERMES` must have the same bytecode version as the
  `hermesc` that compiled the bundle. `hermes --version` and
  `hermesc --version` both print it (98 for this tag).

## How the bundle is made

`build.mjs` does what a release build does, as closely as it can without an
app:

1. **Stylesheet, in Node.** The CSS is built with `bench/stylesheets.ts` and
   compiled with the compiler under test. The compiler uses lightningcss, a
   native addon that can't run on Hermes, and it's bundler work the bench
   never times. The resulting JSON goes into the bundle, and
   `StyleCollection.inject` runs on the engine, as in an app.
2. **Bundle, with esbuild.** `bench/suite.tsx` with its `./harness`,
   `./libraries` and `./stylesheets` swapped for the stand-ins in
   `bench/hermes/`, `react-native` replaced by `bench/hermes/react-native.tsx`,
   plus React and `react-test-renderer`. Production React has no `act()`, so
   the mock scheduler is flushed instead, as the jest config does.
3. **Babel, with React Native's preset** and the `hermes-stable` transform
   profile. The engine sees the same code shapes an app ships:
   `let`/`const` and destructuring lowered, `async` as generators, and
   classes, spread and `for…of` left native.
4. **`hermesc -O`**, the compiler React Native ships, into `bench.hbc`.

## Differences from the jest bench

- **NativeWind v5 only.** v4 and Uniwind aren't wired up.
- **No React Native.** The stand-in renders host components the way React
  Native's jest mocks do. Its `Pressable` is simplified, so the `active:`
  scenario costs less than under jest. It's the same for every commit and
  engine, so comparisons still hold.
- **No call counters or CPU profiles from the harness.** For a Hermes
  profile, run the CLI with
  `-sample-profiling=chrome -profiling-out=out.cpuprofile`, or use the
  sampling profiler in a release app.

## Results for the `perf:` commits

Each commit against its parent, same bundle on both engines, `BENCH_GC=1`
except where noted, 1000 items, production React, plain CSS. Hermes is the
V1 CLI above on x86-64; V8 is Node 22.

| Commit  | Change                                           | Hermes                                                   | V8                            |
| ------- | ------------------------------------------------ | -------------------------------------------------------- | ----------------------------- |
| 46bf553 | Avoid the second rule/style pass on fresh mounts | About −30% on mounts and remounts                        | About −30%, same pattern      |
| 528bd8b | Reuse cached computed values on re-subscribe     | −17% on themed remounts                                  | Flat                          |
| 5896413 | Make snapshot capture opt-in                     | Flat                                                     | Flat                          |
| 23101c6 | Cache className splits                           | **+21–110% slower** in scenarios after the cache fills   | Flat                          |
| bcc608f | Cache interaction-family membership              | −4–6% on remounts and rerenders (near noise)             | Flat                          |
| da86a81 | Cache derived configs per mapping                | −51% remounts, −10–37% mounts (about 170 ms per remount) | −72% remounts, −29–55% mounts |
| f720433 | Fast paths in style prop merging                 | Flat                                                     | Flat                          |
| 42decb1 | Filter inline style once per render              | Flat                                                     | Flat                          |

46bf553 was measured before `BENCH_GC` existed; its gains are large enough
not to be affected.

Notes:

- **528bd8b** is the only commit that clearly helps Hermes more than V8.
- **da86a81** is the biggest win on both engines, and saves more
  milliseconds on Hermes.
- **23101c6** removes the split cost as intended: `split(/\s+/)` costs about
  3 µs on Hermes against 0.36 µs on V8, and it disappears from the Hermes
  profile. But once the "unique rule sets, first time" scenario fills the
  cache towards its 10,000-entry limit, later scenarios get much slower on
  Hermes only. Clearing the cache above 100 entries instead removes the
  regression. The underlying cause wasn't identified; total GC time barely
  changes.
- **5896413, f720433, 42decb1** remove operations that are 6–23× slower on
  Hermes than on V8 in micro-benchmarks (against about 4× for the whole
  suite), but each is too small a share of a render to show up here.
