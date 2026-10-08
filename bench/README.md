# `/bench`

Benchmarks for the native runtime, comparing NativeWind v5 (this package)
with NativeWind v4 and Uniwind when they're installed. They run with their
own jest config (`.config/bench.jest.config.cjs`) and never run as part of
`yarn test`.

## Running

From the repo root:

```bash
yarn bench             # development and production React, plain CSS
yarn bench:dev         # development React only
yarn bench:prod        # production React only
yarn bench:tailwind    # both modes, real Tailwind CSS output (see below)
yarn bench:tw-shape    # Tailwind utility shape diagnostic (not a benchmark)
```

v5 always runs. To include the other libraries, point these variables at
installed packages (the package directories):

```bash
BENCH_NW4_INTEROP=/path/to/node_modules/react-native-css-interop \
BENCH_UNIWIND=/path/to/node_modules/uniwind \
  yarn bench
```

| Variable            | Default | Meaning                                                     |
| ------------------- | ------- | ----------------------------------------------------------- |
| `BENCH_RUNS`        | 10      | Timed iterations per scenario                               |
| `BENCH_WARMUP`      | 3       | Untimed iterations before timing (at least 10 for startup)  |
| `BENCH_ITEMS`       | 1000    | Items per tree in the suite                                 |
| `BENCH_ROWS`        | 500     | Memoized rows in `group.bench.tsx`                          |
| `BENCH_CSS`         | `plain` | Stylesheet for the suite and startup: `plain` or `tailwind` |
| `BENCH_NW4_INTEROP` | unset   | Path to react-native-css-interop; enables NativeWind v4     |
| `BENCH_UNIWIND`     | unset   | Path to uniwind; enables Uniwind                            |
| `BENCH_PROFILE`     | unset   | Directory to write `.cpuprofile` files to                   |
| `BENCH_SUMMARY`     | auto    | `1` or `0` to force the end-of-run summary on or off        |

Extra arguments are passed to jest, e.g. `yarn bench bench/group.bench.tsx`
runs one file in both modes.

## Output

In an interactive terminal, results are collected and printed as one summary
at the end of the run: a table per React mode and stylesheet or benchmark
file, with the median and (min–max) in ms. When other libraries ran, a
`nw5/<library>` column divides v5's median by theirs: below 1× means v5 is
faster. `yarn bench` prints a single summary covering both modes.

When output isn't a terminal (piped, or CI), each result is instead printed
as it happens, as one `BENCH {...}` JSON line labelled with the library, React
mode and stylesheet. `BENCH_SUMMARY` overrides the choice.

How it works: `harness.ts` appends each result to a temporary file
(`BENCH_RESULTS_FILE`), and the jest reporter (`reporter.cjs`), or the `yarn
bench` runner (`run.cjs`) for both modes, formats it with `summary.cjs` once
everything has finished.

## What is measured

Every library compiles CSS at build time, in the bundler, and at runtime
loads the result once and then resolves styles per component. The
benchmarks time only the runtime part. Each library has an adapter in
`libraries.tsx` that splits its work the same way an app does:

- **Build** (never timed): what the bundler does.
  - v5: `compile()`, shipped as `StyleCollection.inject(<JSON>)`, as its
    Metro transformer does.
  - v4: `cssToReactNativeRuntime()`, shipped as `injectData(<JSON>)`.
  - Uniwind: its own Metro transformer, called with Metro's transform worker
    replaced by one that returns the code unchanged (`uniwind.ts`). The
    result is the exact module Uniwind generates for an app,
    `Uniwind.__reinit(rt => ({ stylesheet: … }), themes)`; only Babel's pass
    over it is skipped. Uniwind exports nothing else that compiles native
    styles.
- **Load** (timed by the startup benchmark): running that shipped code. The
  artifact is parsed beforehand, as the JS engine does when loading the
  bundle.
- **Render** (timed by the suite): each library's own components. For
  Uniwind these are the components its Metro resolver substitutes for React
  Native's in an app.

A few choices keep the libraries doing the same work:

- **Production mode is production.** With `NODE_ENV=production`, React's
  production builds are used, and `setup.ts` sets `__DEV__` to false, which
  React Native's jest setup otherwise forces to true. Uniwind and React
  Native take their production paths.
- **`active:` runs on Pressable.** v5 turns a View with an `active:` class
  into a pressable, but Uniwind applies interaction states only on
  Pressable, so on a View it would skip the work.
- **Unique rule sets come in two variants.** Uniwind keeps resolved styles
  for every class string it has seen; v5 drops style sets nothing uses.
  "repeat" renders the same class strings each run (a list remounting the
  same items), and "first time" uses class names no earlier run has used,
  so no cache can help.

## The suite (`nw5`, `nw4`, `uniwind` `.bench.tsx`)

Every library renders the same trees and classes from `suite.tsx`.

- **Themed tree**: key-swap remount, remount with a stable inline style,
  re-render with the same props, re-render with a new inline style, remount
  of wrapped components without classes, and a raw React Native baseline.
  The root provides the CSS variables each library's way (`vars()` for v4
  and v5, `ScopedVariables` for Uniwind).
- **Targeted scenarios**: flat trees that each isolate one runtime path:
  shared className, unique className strings, unique rule sets (repeat and
  first time), className toggles, an `active:` pseudo-class and a media
  query. Mount scenarios mount a fresh tree each run, so nothing held by
  live components carries over.
- **Style checks**: every styled scenario asserts that the first item
  received its styles: border radius and the color resolved from the CSS
  variable for the themed tree, padding for the targeted scenarios.
  Shorthand or longhand padding and radius both count.
- **Call counts** (v5 only): `calculateProps` calls on first render and per
  timed run. Remounts report 0 per run because the old tree still holds the
  shared style observables; unique rule sets report one call per item.
- **Optional libraries**: `nw4.bench.tsx` and `uniwind.bench.tsx` run only
  when their variable is set, and skip themselves otherwise. React, React
  Native and scheduler are then pinned to this package's copies, so a
  library installed elsewhere can't load its own React.

## Stylesheets: plain CSS and Tailwind

`BENCH_CSS` selects the stylesheet for the suite and startup benchmark
(`stylesheets.ts`):

- **`plain`** (default): hand-written CSS, one simple rule per class. Fast to
  build and identical input for every library.
- **`tailwind`**: built at test time with Tailwind CSS v4. v5 gets Tailwind's
  output with NativeWind's theme (`nativewind-theme.css`, a trimmed copy of
  `nativewind/theme`), as a NativeWind v5 app ships: rem-based values,
  utilities that declare their own variables (font weight and text color,
  for example) and runtime-computed declarations. Uniwind runs Tailwind
  itself in its transformer, so it builds from the same classes and project
  theme with its own theme, as a Uniwind app would.

Both stylesheets define the same class names, so their results compare
directly. Tailwind generates exactly the classes listed in `CLASSES` in
`suite.tsx`, plus the `mt-[Npx]` classes for the unique rule set scenarios:
one per item for each render (initial, warmup and timed), 14,000 at the
defaults. **To add a class**, add it to `CLASSES` and give it a rule in
`plainCss()` in `stylesheets.ts`.

Things to know about the Tailwind mode:

- **No v4.** NativeWind v4 is built on Tailwind CSS v3, so it is skipped
  under `BENCH_CSS=tailwind`, even when `BENCH_NW4_INTEROP` is set.
- **Tailwind versions can differ.** v5 uses this package's Tailwind; Uniwind
  uses the Tailwind installed alongside it.
- **Expected values differ by library.** Tailwind sizes are in rem: `p-4`
  and `rounded-2xl` are 1rem, which is 14px for v5 and 16px for Uniwind. The
  style checks take each library's rem into account; plain CSS is 16px for
  everyone.
- **Theme colors need two declarations (v5).** The project colors
  (`bg-primary`, `bg-gray`, `text-typography`) come from an `@theme` block
  plus a dark-mode override. v5's compiler inlines any CSS variable declared
  exactly once, which would turn these utilities into static colors and skip
  runtime variable resolution, so the themed tree would no longer measure
  it. A themed app declares light and dark values, as here. The `@theme`
  defaults are deliberately different from the values the root provides, so
  the color check confirms those won.

  The same applies to apps: a color declared once in `@theme` can't be
  overridden with `vars()`. Declare it more than once, or use the compiler's
  `inlineVariables.exclude` option.

- **Build time.** Each test file builds its stylesheet once, in a
  `beforeAll`.

## Other benchmarks

- **`startup.bench.tsx`**: loading a large stylesheet (about 2,000 classes)
  into each library's runtime: cold, as at launch, and reloading it
  unchanged, as on a Fast Refresh. Follows `BENCH_CSS`. v4 stores the rules
  and initializes each one the first time it's used, so its load is cheap
  and that cost appears in the suite's mount times instead. Uniwind replaces
  its stylesheet wholesale on every load, so its cold and reload numbers
  match.
- **`group.bench.tsx`** (v5 only): re-render cost of a `group` parent above
  memoized rows, versus a plain parent, with row and styled-component render
  counts. Uniwind has no `group-*` support. Uses its own small stylesheet;
  `BENCH_CSS` doesn't affect it.
- **`tw-shape.diag.tsx`**: not a benchmark. Reports each Tailwind utility's
  runtime shape in v5 (declares variables, declares a container, reads
  variables, conditional, runtime-computed, animated). Set `TW_CLASSES` to
  inspect your own list.

## Interpreting results

These benchmarks run in Node, on V8, which compiles hot code to machine code
as it runs. Apps run on Hermes, which precompiles to bytecode and does far
less runtime optimization. The libraries take different approaches: Uniwind
generates thousands of small JavaScript functions at build time, while v4
and v5 interpret style data at runtime. Those approaches can rank
differently on Hermes than on V8.

Startup is the clearest case. In an app the stylesheet module runs once, on
a cold engine; here it runs many times after warmup, so the startup
benchmark measures the work each library does, not first-run engine cost.

Use these results to explain why a library costs what it does (cache hits,
render counts, which path is taken) and to catch regressions. For how fast
each library is in an app, measure on a device.

## Profiling and isolation

Profiling is opt-in with `BENCH_PROFILE=<dir>` and runs as a separate pass
after timing, so it never affects the timed runs. The config uses a single
worker so suites don't compete for CPU. Timings come from
`process.hrtime.bigint()`, because React Native's jest setup replaces
`performance.now()` with a millisecond-resolution clock.

Uniwind's transformer writes its generated `uniwind.css` into the uniwind
package, as it does in an app; its type declarations go to a temporary
folder.
