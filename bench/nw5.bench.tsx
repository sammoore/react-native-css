/**
 * NativeWind v5's runtime (this package). See libraries.tsx.
 */
import { nw5, withLibrary } from "./libraries";
import { runSuite } from "./suite";

withLibrary(nw5(), runSuite);
