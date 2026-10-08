/* eslint-disable */
/**
 * The benchmark tree and scenarios, shared by every library under test so
 * each one renders exactly the same components, classes and CSS.
 *
 * The tree mirrors the on-device benchmark app: a root View providing CSS
 * variables via vars(), a header, and a container of ITEMS_COUNT item Views
 * (6 classes, one var() color), each with a Text child (3 classes, one var()
 * color).
 *
 * The targeted scenarios after it use flat trees of plain Views, each
 * isolating one runtime path: className string caching, per-instance rule
 * resolution, rule re-collection, interaction state and media queries.
 *
 * BENCH_CSS selects the stylesheet (see stylesheets.ts). Every class name
 * rendered here is listed in CLASSES, so the Tailwind build generates exactly
 * those utilities.
 */
import type { ComponentType, ReactElement } from "react";
import { Text as RNText, View as RNView, StyleSheet } from "react-native";

import {
  act,
  create,
  measure,
  MODE,
  profile,
  report,
  RUNS,
  WARMUP_RUNS,
  type Renderer,
} from "./harness";
import {
  loadStylesheet,
  STYLESHEET,
  uniqueClass,
  type Stylesheet,
} from "./stylesheets";

export const ITEMS_COUNT = Number(process.env.BENCH_ITEMS ?? 1000);

export const THEME = {
  "--color-primary": "#00a8ff",
  "--color-gray": "#f0f0f0",
  "--color-typography": "#000000",
};

/** Every class string the suite renders, apart from uniqueClass(index). */
const CLASSES = {
  root: "flex-1",
  header: "flex-1 mb-4 p-4 rounded-lg bg-gray",
  title: "text-lg text-typography font-bold text-center mb-1",
  container: "flex-row flex-wrap gap-2",
  item: "w-[32%] h-[100px] rounded-2xl bg-primary items-center justify-center",
  itemText: "text-typography font-bold text-2xl",
  flat: "p-4 rounded-2xl bg-red-500",
  toggleA: "p-4 rounded-2xl",
  toggleB: "p-4 bg-red-500",
  active: "p-4 active:opacity-50",
  media: "p-4 md:flex-row",
};
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
      className={cls(CLASSES.root)}
    >
      <View className={cls(CLASSES.header)}>
        <Text className={cls(CLASSES.title)}>Benchmark</Text>
      </View>
      <View key={renderKey} className={cls(CLASSES.container)}>
        {Array.from({ length: ITEMS_COUNT }, (_, index) => (
          <View
            key={index}
            testID={`item-${index}`}
            className={cls(CLASSES.item)}
            style={itemStyle}
          >
            <Text className={cls(CLASSES.itemText)}>{index}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Flat trees for the targeted scenarios: ITEMS_COUNT Views under a plain
 * root, without the themed tree's variables or Text children, so each one
 * isolates a single runtime path.
 */
function FlatApp({
  lib,
  className,
  renderKey,
}: {
  lib: BenchLibrary;
  className: (index: number) => string;
  renderKey: number;
}) {
  const { View } = lib;
  return (
    <View key={renderKey}>
      {Array.from({ length: ITEMS_COUNT }, (_, index) => (
        <View
          key={index}
          testID={`item-${index}`}
          className={className(index)}
        />
      ))}
    </View>
  );
}

interface RunState {
  renderKey: number;
  tick: number;
}

interface Scenario {
  name: string;
  /**
   * - remount: swap the container key, so the old tree unmounts after the new
   *   one renders. Live components keep shared style observables alive, so
   *   this measures the cached path.
   * - rerender: update the same tree in place.
   * - mount: unmount the previous tree, then mount a fresh one (both timed),
   *   so nothing cached by live components carries over between runs.
   */
  kind: "remount" | "rerender" | "mount";
  render: (lib: BenchLibrary, state: RunState) => ReactElement;
  /** Sanity check that styles were applied. */
  check?: (renderer: Renderer, expected: Stylesheet["expected"]) => void;
}

function themed(mode: Mode) {
  return (lib: BenchLibrary, { renderKey, tick }: RunState) => (
    <BenchApp lib={lib} mode={mode} renderKey={renderKey} tick={tick} />
  );
}

function flat(className: (index: number, state: RunState) => string) {
  return (lib: BenchLibrary, state: RunState) => (
    <FlatApp
      lib={lib}
      className={(index) => className(index, state)}
      renderKey={state.renderKey}
    />
  );
}

/** The first item's flattened styles, across the wrapper and host nodes. */
function firstItemStyles(renderer: Renderer) {
  return renderer.root
    .findAll((node) => node.props.testID === "item-0")
    .map((node) => StyleSheet.flatten(node.props.style))
    .filter(Boolean);
}

/** Rounded, and colored by the vars() on the root View. */
function expectThemed(renderer: Renderer, expected: Stylesheet["expected"]) {
  expect(firstItemStyles(renderer)).toContainEqual(
    expect.objectContaining({
      borderRadius: expected.borderRadius,
      backgroundColor: THEME["--color-primary"],
    }),
  );
}

function expectPadded(renderer: Renderer, expected: Stylesheet["expected"]) {
  expect(firstItemStyles(renderer)).toContainEqual(
    expect.objectContaining({ padding: expected.padding }),
  );
}

const SCENARIOS: Scenario[] = [
  {
    name: "remount",
    kind: "remount",
    render: themed("styled"),
    check: expectThemed,
  },
  {
    name: "remount, stable inline style",
    kind: "remount",
    render: themed("stable-inline"),
    check: expectThemed,
  },
  {
    name: "rerender, same props",
    kind: "rerender",
    render: themed("styled"),
    check: expectThemed,
  },
  {
    name: "rerender, new inline style",
    kind: "rerender",
    render: themed("fresh-inline"),
    check: expectThemed,
  },
  {
    name: "remount, wrapped without classes",
    kind: "remount",
    render: themed("unstyled"),
  },
  { name: "remount, raw react-native", kind: "remount", render: themed("raw") },

  // Targeted scenarios: each isolates one runtime path.
  {
    name: "mount, shared className",
    kind: "mount",
    render: flat(() => CLASSES.flat),
    check: expectPadded,
  },
  {
    // Same rules, but a distinct string per item: defeats caches keyed on the
    // className string (e.g. the split cache) while still sharing rule sets.
    name: "mount, unique className strings",
    kind: "mount",
    render: flat((index) => CLASSES.flat + " ".repeat(index + 1)),
    check: expectPadded,
  },
  {
    // A distinct rule set per item: no style observable can be shared, so
    // every instance resolves its own declarations.
    name: "mount, unique rule sets",
    kind: "mount",
    render: flat((index) => `${CLASSES.flat} ${uniqueClass(index)}`),
    check: expectPadded,
  },
  {
    // Alternates between two rule sets in place, exercising updateRules.
    name: "rerender, className toggles",
    kind: "rerender",
    render: flat((_, { tick }) =>
      tick % 2 ? CLASSES.toggleA : CLASSES.toggleB,
    ),
    check: expectPadded,
  },
  {
    // Interaction state: attaches press handlers and makes Views pressable.
    name: "mount, active: pseudo-class",
    kind: "mount",
    render: flat(() => CLASSES.active),
    check: expectPadded,
  },
  {
    // Media query: rule matching reads and subscribes to the window width.
    name: "mount, media query",
    kind: "mount",
    render: flat(() => CLASSES.media),
    check: expectPadded,
  },
];

export function runSuite(lib: BenchLibrary) {
  describe(`${lib.name}, ${MODE}, ${STYLESHEET} CSS (${ITEMS_COUNT} items, ${RUNS} runs, ${WARMUP_RUNS} warmup)`, () => {
    let stylesheet: Stylesheet;
    beforeAll(async () => {
      stylesheet = await loadStylesheet(Object.values(CLASSES), ITEMS_COUNT);
    }, 120_000);

    for (const scenario of SCENARIOS) {
      test(scenario.name, async () => {
        lib.setup(stylesheet.css);
        const state: RunState = { renderKey: 0, tick: 0 };
        const element = () => scenario.render(lib, state);
        const initial = lib.counters?.();
        let renderer!: Renderer;
        act(() => {
          renderer = create(element());
        });
        const firstRender = lib.counters?.();
        const step = () => {
          state.tick++;
          if (scenario.kind === "remount") state.renderKey++;
          if (scenario.kind === "mount") {
            act(() => {
              renderer.unmount();
            });
            act(() => {
              renderer = create(element());
            });
          } else {
            act(() => {
              renderer.update(element());
            });
          }
        };

        for (let i = 0; i < WARMUP_RUNS; i++) step();
        const before = lib.counters?.();
        const stats = measure(step, RUNS, 0);
        const after = lib.counters?.();

        const extra: Record<string, unknown> = { css: stylesheet.name };
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

        scenario.check?.(renderer, stylesheet.expected);

        if (scenario === SCENARIOS[0]) {
          await profile(`${lib.name}-${stylesheet.name}-remount`, () => {
            for (let i = 0; i < RUNS; i++) step();
          });
        }

        act(() => {
          renderer.unmount();
        });
      });
    }
  });
}
