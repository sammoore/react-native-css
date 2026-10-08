/**
 * Uniwind, rendering the same tree as nw5.bench.tsx. Enabled with
 * BENCH_UNIWIND; see libraries.tsx.
 */
import { uniwind, withLibrary } from "./libraries";
import { runSuite } from "./suite";

withLibrary(uniwind(), runSuite);
