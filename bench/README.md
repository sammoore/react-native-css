# `/bench`

- **Tests remounts of styled and unstyled components**: key-swap remount, remount with a stable inline style, re-render with the same props, re-render with a new inline style, remount of wrapped components without classes, and a raw React Native baseline.
- **Style checks**: Every styled scenario asserts that the first item has its border radius and its color resolved from the CSS variable.
- **v4 side**: nw4.bench.tsx runs only when BENCH_NW4_INTEROP points at an installed react-native-css-interop, and skips itself otherwise. The React / React Native / scheduler pinning from the patch only applies in that case.
- **Call counts**: I kept only the calculateProps counter, which I confirmed intercepts real calls. It reports calls on first render (6 for the styled scenarios) and per timed run (0). The 0 is real: after warmup, remounted items reuse style observables the old tree is still holding.
- **Profiling and isolation**: Profiling is opt-in with BENCH_PROFILE=<dir> and runs as a separate pass after timing. The config pins a single worker so the v4 and v5 suites don't compete for CPU.

To run (from the repo root):

```bash
yarn jest -c .config/bench.jest.config.cjs
BENCH_NW4_INTEROP=/path/to/react-native-css-interop yarn jest -c .config/bench.jest.config.cjs
```

You can also set `BENCH_RUNS`, `BENCH_WARMUP` and `BENCH_ITEMS`.
