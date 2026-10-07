/* eslint-disable */
/**
 * Nativewind v5 runtime (this package). Run with:
 *   yarn jest -c .config/bench.jest.config.cjs
 */
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";
import { vars } from "react-native-css/runtime";

import { runSuite, THEME } from "./suite";

/**
 * Count calculateProps calls. Babel's CommonJS output calls cross-module
 * imports through the exporting module's object, so replacing the export
 * intercepts calls from styles/index.ts. (This does not work for calls made
 * inside the same module, which is why only calculateProps is counted.)
 */
const calculatePropsModule = require("../src/native/styles/calculate-props");
let calculatePropsCalls = 0;
const originalCalculateProps = calculatePropsModule.calculateProps;
calculatePropsModule.calculateProps = (...args: unknown[]) => {
  calculatePropsCalls++;
  return originalCalculateProps(...args);
};

runSuite({
  name: "nw5",
  View,
  Text,
  themeVars: vars(THEME),
  setup: registerCSS,
  counters: () => ({ calculateProps: calculatePropsCalls }),
});
