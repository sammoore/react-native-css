/* eslint-disable */
/**
 * Startup cost: loading a large stylesheet (about 2,000 classes) into each
 * library's runtime, the work an app does when its stylesheet module runs at
 * launch, and again on every Fast Refresh.
 *
 * - cold: the runtime's styles are cleared before each run, as at launch.
 * - reload unchanged: the same stylesheet loaded over itself, as on a Fast
 *   Refresh that didn't change any CSS.
 *
 * Building the stylesheet (what the bundler does) is never timed, and neither
 * is preparing the shipped artifact (parsing it, as the JS engine does when
 * loading the bundle); see libraries.tsx. BENCH_CSS selects plain CSS or
 * Tailwind output, as for the suite.
 */
import { measure, report, RUNS, WARMUP_RUNS } from "./harness";
import {
  nw4,
  nw5,
  uniwind,
  withLibrary,
  type LibraryResult,
} from "./libraries";
import { loadLargeStylesheet, type StylesheetSource } from "./stylesheets";
import { largeClassList } from "./tailwind";

const LIBRARIES: LibraryResult[] = [nw5(), nw4(), uniwind()];

/**
 * Loads take milliseconds, and a large stylesheet module (Uniwind's is one
 * big generated function) needs about ten runs before V8 has finished
 * optimizing it. With fewer, the first timed runs measure V8 warming up
 * rather than the library, so warm up at least ten times.
 */
const WARMUP = Math.max(WARMUP_RUNS, 10);

let stylesheet: StylesheetSource;
beforeAll(async () => {
  stylesheet = await loadLargeStylesheet();
}, 120_000);

for (const result of LIBRARIES) {
  withLibrary(result, (lib) => {
    describe(`${lib.name} startup`, () => {
      let artifact: string;
      beforeAll(async () => {
        artifact = await lib.build(stylesheet);
      }, 120_000);

      const extra = () => ({
        css: stylesheet.name,
        classes: largeClassList().length,
        artifactKB: Math.round(artifact.length / 1024),
      });

      test("cold", () => {
        let load!: () => void;
        const stats = measure(
          () => load(),
          RUNS,
          WARMUP,
          () => {
            lib.reset();
            load = lib.instantiate(artifact);
          },
        );
        report(lib.name, "startup, cold", stats, extra());
      });

      test("reload unchanged", () => {
        lib.reset();
        lib.instantiate(artifact)();
        let load!: () => void;
        const stats = measure(
          () => load(),
          RUNS,
          WARMUP,
          () => {
            load = lib.instantiate(artifact);
          },
        );
        report(lib.name, "startup, reload unchanged", stats, extra());
      });
    });
  });
}
