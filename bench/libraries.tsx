/* eslint-disable */
/**
 * Adapters for the libraries under test. Each one splits its work the way an
 * app does:
 *
 * - build(stylesheet): what the bundler does at build time, compiling CSS into
 *   the artifact the app ships. Never timed.
 * - instantiate(artifact): prepares the shipped artifact (e.g. parsing it, as
 *   the JS engine would when loading the bundle) and returns load(), which
 *   performs what the app does when that module runs at startup: handing the
 *   stylesheet to the runtime. load() is what the startup benchmark times.
 * - reset(): clears the runtime's styles, as before the app launches.
 *
 * Optional libraries are only required when enabled, so their packages don't
 * need to be installed otherwise.
 */
import type { ComponentType, ReactNode } from "react";
import {
  Pressable as RNPressable,
  Text as RNText,
  View as RNView,
} from "react-native";

import { STYLESHEET, type StylesheetSource } from "./stylesheets";

/** CSS variables the suite provides on its root, and their values. */
export const THEME = {
  "--color-primary": "#00a8ff",
  "--color-gray": "#f0f0f0",
  "--color-typography": "#000000",
};

export interface BenchLibrary {
  name: string;
  View: ComponentType<any>;
  Text: ComponentType<any>;
  Pressable: ComponentType<any>;
  /**
   * The suite's root View, providing THEME's variables to its children the
   * way this library does it. Accepts the same props as View.
   */
  ThemedView: ComponentType<{ className?: string; children?: ReactNode }>;
  /** Pixels per rem in this library's Tailwind output. */
  rem: number;
  build(stylesheet: StylesheetSource): Promise<string>;
  instantiate(artifact: string): () => void;
  reset(): void;
  /** Optional cumulative call counters, reported per timed run. */
  counters?: () => Record<string, number>;
}

/** A library, or the reason it is skipped. */
export type LibraryResult = BenchLibrary | { name: string; skip: string };

export function nw5(): LibraryResult {
  // Resets runtime state (styles, dimensions, color scheme) before each test.
  require("react-native-css/jest");
  const { compile } = require("react-native-css/compiler");
  const { StyleCollection } = require("react-native-css/native-internal");
  const { Pressable } = require("react-native-css/components/Pressable");
  const { Text } = require("react-native-css/components/Text");
  const { View } = require("react-native-css/components/View");
  const { vars } = require("react-native-css/runtime");

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

  const themeVars = vars(THEME);
  return {
    name: "nw5",
    View,
    Text,
    Pressable,
    ThemedView: (props) => <View {...props} style={themeVars} />,
    rem: 14,
    // Metro runs compile() and ships StyleCollection.inject(<JSON>).
    build: async ({ css }) => JSON.stringify(compile(css, {}).stylesheet()),
    instantiate: (artifact) => {
      const data = JSON.parse(artifact);
      return () => StyleCollection.inject(data);
    },
    reset: () => {
      StyleCollection.styles.clear();
      StyleCollection.keyframes.clear();
    },
    counters: () => ({ calculateProps: calculatePropsCalls }),
  };
}

/**
 * NativeWind v4's runtime (react-native-css-interop). Not a dependency of this
 * package: set BENCH_NW4_INTEROP to an installed copy to enable it.
 *
 * Uses cssInterop()-wrapped components directly. That is the code path v4's
 * JSX runtime swap selects, without needing its babel transform.
 */
export function nw4(): LibraryResult {
  if (STYLESHEET === "tailwind") {
    return {
      name: "nw4",
      skip: "NativeWind v4 uses Tailwind CSS v3; BENCH_CSS=tailwind excludes it",
    };
  }
  if (!process.env.BENCH_NW4_INTEROP) {
    return { name: "nw4", skip: "set BENCH_NW4_INTEROP to enable" };
  }

  const interop = require("react-native-css-interop");
  const {
    cssToReactNativeRuntime,
  } = require("react-native-css-interop/dist/css-to-rn");
  const {
    injectData,
    resetData,
  } = require("react-native-css-interop/dist/runtime/native/styles");

  const View = interop.cssInterop(RNView, { className: "style" });
  const themeVars = interop.vars(THEME);
  return {
    name: "nw4",
    View,
    Text: interop.cssInterop(RNText, { className: "style" }),
    Pressable: interop.cssInterop(RNPressable, { className: "style" }),
    ThemedView: (props) => <View {...props} style={themeVars} />,
    rem: 14,
    // v4's Metro transformer ships injectData(<JSON>).
    build: async ({ css }) => JSON.stringify(cssToReactNativeRuntime(css)),
    instantiate: (artifact) => {
      const data = JSON.parse(artifact);
      return () => injectData(data);
    },
    reset: resetData,
  };
}

/**
 * Uniwind. Not a dependency of this package: set BENCH_UNIWIND to an installed
 * copy (the package directory) to enable it.
 *
 * Its components are the ones Uniwind's Metro resolver substitutes for React
 * Native's in an app. Its stylesheet is built by Uniwind's own transformer
 * (see uniwind.ts) and loaded by running the module it generates.
 */
export function uniwind(): LibraryResult {
  if (!process.env.BENCH_UNIWIND) {
    return { name: "uniwind", skip: "set BENCH_UNIWIND to enable" };
  }

  const { ScopedVariables } = require("uniwind");
  const { Pressable } = require("uniwind/components/Pressable");
  const { Text } = require("uniwind/components/Text");
  const { View } = require("uniwind/components/View");
  const { compileUniwind } = require("./uniwind");

  return {
    name: "uniwind",
    View,
    Text,
    Pressable,
    ThemedView: (props) => (
      <ScopedVariables variables={THEME}>
        <View {...props} />
      </ScopedVariables>
    ),
    // Uniwind's default rem.
    rem: 16,
    build: compileUniwind,
    instantiate: (code) => {
      // Parse the module, as the JS engine does when loading the bundle; its
      // `require('uniwind')` resolves to the same runtime as the components.
      const module = new Function("require", code);
      return () => module(require);
    },
    // Each load replaces Uniwind's stylesheet and style caches wholesale.
    reset: () => {},
  };
}

/** Define a test file's tests for a library, or a skipped placeholder. */
export function withLibrary(
  result: LibraryResult,
  define: (lib: BenchLibrary) => void,
) {
  if ("skip" in result) {
    test.skip(`${result.name} (${result.skip})`, () => {});
  } else {
    define(result);
  }
}
