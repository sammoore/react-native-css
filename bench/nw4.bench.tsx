/* eslint-disable */
/**
 * Nativewind v4 runtime (react-native-css-interop), rendering the same tree as
 * nw5.bench.tsx for a head-to-head comparison in one jest run.
 *
 * react-native-css-interop is not a dependency of this package. Point
 * BENCH_NW4_INTEROP at an installed copy (the package directory) to enable
 * this suite; it is skipped otherwise:
 *   BENCH_NW4_INTEROP=/path/to/node_modules/react-native-css-interop \
 *     yarn jest -c .config/bench.jest.config.cjs
 *
 * Uses cssInterop()-wrapped components directly. That is the code path v4's
 * JSX runtime swap selects, without needing its babel transform.
 */
import { Text as RNText, View as RNView } from "react-native";

import { runSuite, THEME } from "./suite";

if (process.env.BENCH_NW4_INTEROP) {
  const interop = require("react-native-css-interop");
  const {
    cssToReactNativeRuntime,
  } = require("react-native-css-interop/dist/css-to-rn");
  const {
    injectData,
  } = require("react-native-css-interop/dist/runtime/native/styles");

  runSuite({
    name: "nw4",
    View: interop.cssInterop(RNView, { className: "style" }),
    Text: interop.cssInterop(RNText, { className: "style" }),
    themeVars: interop.vars(THEME),
    setup: (css) => injectData(cssToReactNativeRuntime(css)),
  });
} else {
  test.skip("nw4 (set BENCH_NW4_INTEROP to enable)", () => {});
}
