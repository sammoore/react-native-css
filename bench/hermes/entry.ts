/* eslint-disable */
/**
 * Entry point of the plain-script bench bundle (see README.md). Runs the
 * shared suite (../suite.tsx) for NativeWind v5 and prints `BENCH {...}`
 * lines. build.mjs evaluates ./globals before this module and the suite,
 * which read jest's globals and process.env while their modules evaluate.
 */
import { runSuite } from "../suite";
import { runCollected, setTestPath } from "./globals";
import { CLOCK, ENGINE, GC, MODE } from "./harness";
import { nw5, withLibrary } from "./libraries";

declare const __BENCH_FILTER__: string;

setTestPath("nw5.bench.tsx");
console.log(
  `# engine=${ENGINE} mode=${MODE} clock=${CLOCK.name} gc-between-runs=${GC}`,
);
withLibrary(nw5(), runSuite);

runCollected(__BENCH_FILTER__ ? new RegExp(__BENCH_FILTER__) : undefined).then(
  (failures) => {
    if (failures.length) console.log(`# ${failures.length} failed`);
  },
  (error) => console.log(`# error: ${error?.stack ?? error}`),
);
