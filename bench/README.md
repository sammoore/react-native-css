# `/bench`

Benchmarks for the native runtime. They run with their own jest config
(`.config/bench.jest.config.cjs`) and never run as part of `yarn test`.

## Running

From the repo root:

```bash
yarn bench             # development and production React, plain CSS
yarn bench:dev         # development React only
yarn bench:prod        # production React only
yarn bench:tailwind    # both modes, real Tailwind CSS output (see below)
yarn bench:tw-shape    # Tailwind utility shape diagnostic (not a benchmark)
```

To include NativeWind v4, point `BENCH_NW4_INTEROP` at an installed
react-native-css-interop:

```bash
BENCH_NW4_INTEROP=/path/to/node_modules/react-native-css-interop yarn bench
```

| Variable            | Default | Meaning                                                |
| ------------------- | ------- | ------------------------------------------------------ |
| `BENCH_RUNS`        | 10      | Timed iterations per scenario                          |
| `BENCH_WARMUP`      | 3       | Untimed iterations before timing                       |
| `BENCH_ITEMS`       | 1000    | Items per tree in the suite                            |
| `BENCH_ROWS`        | 500     | Memoized rows in `group.bench.tsx`                     |
| `BENCH_CSS`         | `plain` | Suite stylesheet: `plain` or `tailwind`                |
| `BENCH_NW4_INTEROP` | unset   | Path to react-native-css-interop; enables the v4 suite |
| `BENCH_PROFILE`     | unset   | Directory to write `.cpuprofile` files to              |
| `BENCH_SUMMARY`     | auto    | `1` or `0` to force the end-of-run summary on or off   |

Extra arguments are passed to jest, e.g. `yarn bench bench/group.bench.tsx`
runs one file in both modes.

## Output

In an interactive terminal, results are collected and printed as one summary
at the end of the run: a table per React mode and stylesheet or benchmark
file, with the median and (min–max) in ms. When v4 also ran, a `nw5/nw4`
column compares the two (below 1× means v5 is faster). `yarn bench` prints a
single summary covering both modes.

When output isn't a terminal (piped, or CI), each result is instead printed
as it happens, as one `BENCH {...}` JSON line labelled with the library, React
mode and, for the suite, the stylesheet. `BENCH_SUMMARY` overrides the choice.

How it works: `harness.ts` appends each result to a temporary file
(`BENCH_RESULTS_FILE`), and the jest reporter (`reporter.cjs`), or the `yarn
bench` runner (`run.cjs`) for both modes, formats it with `summary.cjs` once
everything has finished.

## The suite (`nw5.bench.tsx`, `nw4.bench.tsx`)

Both libraries render the same trees and classes from `suite.tsx`.

- **Themed tree**: key-swap remount, remount with a stable inline style,
  re-render with the same props, re-render with a new inline style, remount
  of wrapped components without classes, and a raw React Native baseline.
- **Targeted scenarios**: flat trees that each isolate one runtime path:
  shared className, unique className strings, unique rule sets, className
  toggles, an `active:` pseudo-class and a media query. These mount a fresh
  tree each run, so nothing cached by live components carries over.
- **Style checks**: every styled scenario asserts that the first item
  received its styles: border radius and the color resolved from the CSS
  variable for the themed tree, padding for the targeted scenarios.
- **Call counts** (v5 only): `calculateProps` calls on first render and per
  timed run. Remounts report 0 per run because the old tree still holds the
  shared style observables; unique rule sets report one call per item.
- **v4 side**: `nw4.bench.tsx` runs only when `BENCH_NW4_INTEROP` is set, and
  skips itself otherwise. React, React Native and scheduler are pinned to
  this package's copies only in that case.

## Stylesheets: plain CSS and Tailwind

`BENCH_CSS` selects the stylesheet the suite registers (`stylesheets.ts`):

- **`plain`** (default): hand-written CSS, one simple rule per class. Fast to
  build and identical input for v4 and v5.
- **`tailwind`**: built at test time with Tailwind CSS v4 and NativeWind's
  theme (`nativewind-theme.css`, a trimmed copy of `nativewind/theme`). This
  is what a NativeWind v5 app ships: rem-based values, utilities that declare
  their own variables (font weight and text color, for example) and
  runtime-computed declarations.

Both stylesheets define the same class names, so their results compare
directly. Tailwind generates exactly the classes listed in `CLASSES` in
`suite.tsx`, plus one `mt-[Npx]` per item for the unique rule set scenario.
**To add a class**, add it to `CLASSES` and give it a rule in `plainCss()`
in `stylesheets.ts`.

Things to know about the Tailwind mode:

- **v5 only.** NativeWind v4 is built on Tailwind CSS v3, so
  `nw4.bench.tsx` skips itself under `BENCH_CSS=tailwind`, even when
  `BENCH_NW4_INTEROP` is set.
- **Expected values differ.** `p-4` and `rounded-2xl` resolve to 14 instead
  of 16: Tailwind's spacing is 0.25rem and its `2xl` radius 1rem, and
  react-native-css's default rem is 14. The style checks take their expected
  values from the selected stylesheet.
- **Theme colors need two declarations.** The project colors
  (`bg-primary`, `bg-gray`, `text-typography`) come from an `@theme` block
  plus a dark-mode override. The compiler inlines any CSS variable declared
  exactly once, which would turn these utilities into static colors and skip
  runtime variable resolution, so the themed tree would no longer measure
  it. A themed app declares light and dark values, as here. The `@theme`
  defaults are deliberately different from the `vars()` values on the root
  View, so the color check confirms `vars()` won.

  The same applies to apps: a color declared once in `@theme` can't be
  overridden with `vars()`. Declare it more than once, or use the compiler's
  `inlineVariables.exclude` option.

- **Build time.** Each test file builds the stylesheet once, in a
  `beforeAll`.

## Other benchmarks

- **`inject.bench.tsx`**: startup cost of `StyleCollection.inject` for about
  2,000 compiled Tailwind utilities, cold and re-injecting an unchanged
  stylesheet (as Fast Refresh does). Always uses Tailwind.
- **`group.bench.tsx`**: re-render cost of a `group` parent above memoized
  rows, versus a plain parent, with row and styled-component render counts.
  Uses its own small stylesheet; `BENCH_CSS` doesn't affect it.
- **`tw-shape.diag.tsx`**: not a benchmark. Reports each Tailwind utility's
  runtime shape (declares variables, declares a container, reads variables,
  conditional, runtime-computed, animated). Set `TW_CLASSES` to inspect your
  own list.

## Profiling and isolation

Profiling is opt-in with `BENCH_PROFILE=<dir>` and runs as a separate pass
after timing, so it never affects the timed runs. The config uses a single
worker so suites don't compete for CPU. Timings come from
`process.hrtime.bigint()`, because React Native's jest setup replaces
`performance.now()` with a millisecond-resolution clock.
