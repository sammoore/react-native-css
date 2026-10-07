/* eslint-disable */
/**
 * The benchmark tree and scenarios, shared by every library under test so
 * each one renders exactly the same components, classes and CSS.
 *
 * The tree mirrors the on-device benchmark app: a root View providing CSS
 * variables via vars(), a header, and a container of ITEMS_COUNT item Views
 * (6 classes, one var() color), each with a Text child (3 classes, one var()
 * color).
 */
import type { ComponentType } from "react";
import { Text as RNText, View as RNView, StyleSheet } from "react-native";

import { render } from "@testing-library/react-native";

import { measure, profile, report, RUNS, WARMUP_RUNS } from "./harness";

export const ITEMS_COUNT = Number(process.env.BENCH_ITEMS ?? 1000);

export const CSS = `
  .flex-1 { flex: 1; }
  .flex-row { flex-direction: row; }
  .flex-wrap { flex-wrap: wrap; }
  .gap-2 { gap: 8px; }

  .p-4 { padding: 16px; }
  .mb-4 { margin-bottom: 16px; }
  .rounded-lg { border-radius: 8px; }
  .bg-gray { background-color: var(--color-gray); }

  .text-lg { font-size: 18px; }
  .text-2xl { font-size: 24px; }
  .text-center { text-align: center; }
  .mb-1 { margin-bottom: 4px; }

  .w-\\[32\\%\\] { width: 32%; }
  .h-\\[100px\\] { height: 100px; }
  .rounded-2xl { border-radius: 16px; }
  .bg-primary { background-color: var(--color-primary); }
  .items-center { align-items: center; }
  .justify-center { justify-content: center; }
  .text-typography { color: var(--color-typography); }
  .font-bold { font-weight: 700; }
`;

export const THEME = {
  "--color-primary": "#00a8ff",
  "--color-gray": "#f0f0f0",
  "--color-typography": "#000000",
};

const ITEM_CLASS =
  "w-[32%] h-[100px] rounded-2xl bg-primary items-center justify-center";
const STABLE_INLINE = { marginTop: 1, opacity: 0.9 };

export interface BenchLibrary {
  name: string;
  View: ComponentType<any>;
  Text: ComponentType<any>;
  /** The vars() result for THEME. */
  themeVars: object;
  /** Register CSS with the runtime. Called at the start of every scenario. */
  setup(css: string): void;
  /** Optional cumulative call counters, reported per timed run. */
  counters?: () => Record<string, number>;
}

type Mode = "styled" | "stable-inline" | "fresh-inline" | "unstyled" | "raw";

interface AppProps {
  lib: BenchLibrary;
  mode: Mode;
  renderKey: number;
  tick: number;
}

function BenchApp({ lib, mode, renderKey, tick }: AppProps) {
  const raw = mode === "raw";
  const unstyled = raw || mode === "unstyled";
  const View = raw ? RNView : lib.View;
  const Text = raw ? RNText : lib.Text;
  const cls = (className: string) => (unstyled ? undefined : className);
  const itemStyle =
    mode === "stable-inline"
      ? STABLE_INLINE
      : mode === "fresh-inline"
        ? { marginTop: tick, opacity: 0.9 }
        : undefined;

  return (
    <View
      style={unstyled ? undefined : lib.themeVars}
      className={cls("flex-1")}
    >
      <View className={cls("flex-1 mb-4 p-4 rounded-lg bg-gray")}>
        <Text
          className={cls("text-lg text-typography font-bold text-center mb-1")}
        >
          Benchmark
        </Text>
      </View>
      <View key={renderKey} className={cls("flex-row flex-wrap gap-2")}>
        {Array.from({ length: ITEMS_COUNT }, (_, index) => (
          <View
            key={index}
            testID={`item-${index}`}
            className={cls(ITEM_CLASS)}
            style={itemStyle}
          >
            <Text className={cls("text-typography font-bold text-2xl")}>
              {index}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

interface Scenario {
  name: string;
  mode: Mode;
  /** remount swaps the container key each run; rerender keeps it. */
  remount: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: "remount", mode: "styled", remount: true },
  {
    name: "remount, stable inline style",
    mode: "stable-inline",
    remount: true,
  },
  { name: "rerender, same props", mode: "styled", remount: false },
  { name: "rerender, new inline style", mode: "fresh-inline", remount: false },
  { name: "remount, wrapped without classes", mode: "unstyled", remount: true },
  { name: "remount, raw react-native", mode: "raw", remount: true },
];

/** Sanity check: the first item actually received its resolved styles. */
function expectStyled(api: ReturnType<typeof render>) {
  const styles = api
    .UNSAFE_getAllByProps({ testID: "item-0" })
    .map((node) => StyleSheet.flatten(node.props.style))
    .filter(Boolean);
  expect(styles).toContainEqual(
    expect.objectContaining({
      borderRadius: 16,
      backgroundColor: THEME["--color-primary"],
    }),
  );
}

export function runSuite(lib: BenchLibrary) {
  describe(`${lib.name} (${ITEMS_COUNT} items, ${RUNS} runs, ${WARMUP_RUNS} warmup)`, () => {
    for (const scenario of SCENARIOS) {
      test(scenario.name, async () => {
        lib.setup(CSS);
        let renderKey = 0;
        let tick = 0;
        const element = () => (
          <BenchApp
            lib={lib}
            mode={scenario.mode}
            renderKey={renderKey}
            tick={tick}
          />
        );
        const initial = lib.counters?.();
        const api = render(element());
        const firstRender = lib.counters?.();
        const step = () => {
          tick++;
          if (scenario.remount) renderKey++;
          api.rerender(element());
        };

        for (let i = 0; i < WARMUP_RUNS; i++) step();
        const before = lib.counters?.();
        const stats = measure(step, RUNS, 0);
        const after = lib.counters?.();

        const extra: Record<string, number> = {};
        if (initial && firstRender && before && after) {
          for (const key of Object.keys(after)) {
            extra[`${key}OnFirstRender`] =
              (firstRender[key] ?? 0) - (initial[key] ?? 0);
            extra[`${key}PerRun`] = Math.round(
              ((after[key] ?? 0) - (before[key] ?? 0)) / RUNS,
            );
          }
        }
        report(lib.name, scenario.name, stats, extra);

        if (scenario.mode !== "raw" && scenario.mode !== "unstyled") {
          expectStyled(api);
        }

        if (scenario === SCENARIOS[0]) {
          await profile(`${lib.name}-remount`, () => {
            for (let i = 0; i < RUNS; i++) step();
          });
        }

        api.unmount();
      });
    }
  });
}
