/* eslint-disable */
/**
 * Re-render cost of a `group` (container) parent above memoized styled
 * children, compared with a plain parent.
 *
 * A group parent publishes its container through context, and every styled
 * descendant reads that context. If the parent publishes a new context value
 * on each render, the styled components inside React.memo rows re-render
 * anyway: memo skips the row function, but context updates reach consumers
 * below it. The cost of a parent re-render then scales with the subtree
 * instead of staying constant.
 *
 * Reported per parent render:
 * - memoizedRowRendersPerRun: row function bodies (memo working: 0)
 * - styledRendersPerRun: styled component renders, counted through
 *   getStyledProps (the parent alone: 1)
 */
import { memo } from "react";
import { StyleSheet } from "react-native";

import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

import {
  act,
  create,
  measure,
  report,
  RUNS,
  WARMUP_RUNS,
  type Renderer,
} from "./harness";

const ROWS = Number(process.env.BENCH_ROWS ?? 500);

const CSS = `
  .p-4 { padding: 16px; }
  .bg-solid { background-color: #ef4444; }
  .group:active .group-active\\:opacity-50 { opacity: 0.5; }
`;

/**
 * Count styled component renders. Babel's CommonJS output calls cross-module
 * imports through the exporting module's object, so replacing the export
 * intercepts useNativeCss's calls.
 */
const stylesModule = require("../src/native/styles");
let styledRenders = 0;
const originalGetStyledProps = stylesModule.getStyledProps;
stylesModule.getStyledProps = (...args: unknown[]) => {
  styledRenders++;
  return originalGetStyledProps(...args);
};

let rowRenders = 0;
const Row = memo(function Row({ index }: { index: number }) {
  rowRenders++;
  return (
    <View
      testID={`row-${index}`}
      className="p-4 bg-solid group-active:opacity-50"
    />
  );
});

const rows = Array.from({ length: ROWS }, (_, index) => (
  <Row key={index} index={index} />
));

function Parent({ className, tick }: { className: string; tick: number }) {
  // `tick` changes a prop so the parent itself re-renders every run; the rows
  // are the same elements each time, so memo can skip them.
  return (
    <View className={className} testID={`parent-${tick}`}>
      {rows}
    </View>
  );
}

describe(`group parent re-render (${ROWS} memoized rows)`, () => {
  for (const [name, className] of [
    ["plain parent", "p-4"],
    ["group parent", "group p-4"],
  ] as const) {
    test(name, () => {
      registerCSS(CSS);
      let tick = 0;
      let renderer!: Renderer;
      act(() => {
        renderer = create(<Parent className={className} tick={tick} />);
      });

      const step = () => {
        tick++;
        act(() => {
          renderer.update(<Parent className={className} tick={tick} />);
        });
      };
      for (let i = 0; i < WARMUP_RUNS; i++) step();
      rowRenders = 0;
      styledRenders = 0;
      const stats = measure(step, RUNS, 0);
      report("nw5", `rerender, ${name}`, stats, {
        rows: ROWS,
        memoizedRowRendersPerRun: Math.round(rowRenders / RUNS),
        styledRendersPerRun: Math.round(styledRenders / RUNS),
      });

      // Sanity check: rows received their styles.
      const styles = renderer.root
        .findAll((node) => node.props.testID === "row-0")
        .map((node) => StyleSheet.flatten(node.props.style))
        .filter(Boolean);
      expect(styles).toContainEqual(expect.objectContaining({ padding: 16 }));

      act(() => {
        renderer.unmount();
      });
    });
  }
});
