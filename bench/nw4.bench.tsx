/**
 * NativeWind v4's runtime (react-native-css-interop), rendering the same tree
 * as nw5.bench.tsx. Enabled with BENCH_NW4_INTEROP; see libraries.tsx.
 */
import { nw4, withLibrary } from "./libraries";
import { runSuite } from "./suite";

withLibrary(nw4(), runSuite);
