/* eslint-disable */
/**
 * Stands in for ../libraries.tsx when the suite runs as a plain script.
 *
 * Only NativeWind v5 (this package) runs. Its build step, compile(), uses
 * lightningcss's native addon, so build.mjs runs it in Node ahead of time and
 * bundles the result as `virtual:bench-artifact`; build() here just returns
 * it. Everything that is timed (instantiate/load and rendering) is the same
 * code as under jest.
 *
 * build.mjs resolves `react-native-css/...` to the src/ directory under test,
 * which can be another checkout's, to compare commits.
 */
import type { ComponentType, ReactNode } from "react";
import { Appearance, Dimensions } from "react-native";

import { Pressable } from "react-native-css/components/Pressable";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { StyleCollection } from "react-native-css/native-internal";
import { colorScheme, dimensions } from "react-native-css/native/reactivity";
import { vars } from "react-native-css/runtime";
import artifact from "virtual:bench-artifact";

import { reportSkipped } from "./harness";
import type { StylesheetSource } from "./stylesheets";

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
  ThemedView: ComponentType<{ className?: string; children?: ReactNode }>;
  rem: number;
  build(stylesheet: StylesheetSource): Promise<string>;
  instantiate(artifact: string): () => void;
  reset(): void;
  counters?: () => Record<string, number>;
}

export type LibraryResult = BenchLibrary | { name: string; skip: string };

/** What react-native-css/jest's beforeEach does. */
export function resetRuntime() {
  StyleCollection.styles.clear();
  dimensions.set(Dimensions.get("window"));
  Appearance.setColorScheme("light");
  colorScheme.set(null);
}

export function nw5(): LibraryResult {
  const themeVars = vars(THEME);
  return {
    name: "nw5",
    View,
    Text,
    Pressable,
    ThemedView: (props) => <View {...props} style={themeVars} />,
    rem: 14,
    build: async () => artifact,
    instantiate: (artifact) => {
      const data = JSON.parse(artifact);
      return () => {
        resetRuntime();
        StyleCollection.inject(data);
      };
    },
    reset: () => {
      StyleCollection.styles.clear();
      StyleCollection.keyframes.clear();
    },
  };
}

export const nw4 = (): LibraryResult => ({
  name: "nw4",
  skip: "not available outside jest",
});
export const uniwind = (): LibraryResult => ({
  name: "uniwind",
  skip: "not available outside jest",
});

export function withLibrary(
  result: LibraryResult,
  define: (lib: BenchLibrary) => void,
) {
  if ("skip" in result) {
    reportSkipped(result.name, result.skip);
  } else {
    define(result);
  }
}
