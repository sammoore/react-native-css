/* eslint-disable @typescript-eslint/no-deprecated */
/**
 * Behavioral invariants that runtime caching optimizations must preserve.
 */
import { View as RNView } from "react-native";

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ScrollView } from "react-native-css/components/ScrollView";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme, useCssElement, vars } from "react-native-css/runtime";

import {
  cleanupEffect,
  observable,
  VAR_SYMBOL,
  type Effect,
  type Getter,
} from "../../native/reactivity";

const sub = (): Effect => ({ observers: new Set(), run: jest.fn() });

afterEach(() => {
  act(() => {
    colorScheme.set("light");
  });
});

/* ---------------------------------------------------------------------------
 * reactivity.ts — cached-value reuse on re-subscribe
 * ------------------------------------------------------------------------- */

describe("computed cache reuse", () => {
  test("resubscribing after a dependency changed while detached recomputes", () => {
    const source = observable(1);
    const compute = jest.fn((get: Getter) => get(source) * 2);
    const value = observable(compute);
    const a = sub();
    expect(value.get(a)).toBe(2);
    cleanupEffect(a);
    source.set(5);
    expect(value.get(sub())).toBe(10);
  });

  test("an unobserved set() that switches the dependency set is honored on first subscribe", () => {
    // Mirrors rootVariables(name).set(...) during CSS injection, followed by
    // colorScheme.set(...) before the first component subscribes.
    const first = observable(1);
    const second = observable(10);
    const value = observable<number, boolean>((get, useSecond) =>
      useSecond ? get(second) : get(first),
    );
    expect(value.get()).toBe(1);
    value.set(true);
    second.set(20);
    const s = sub();
    expect(value.get(s)).toBe(20);
    expect(first.observers.size).toBe(0);
    expect(second.observers.size).toBe(1);
    cleanupEffect(s);
    expect(second.observers.size).toBe(0);
  });

  test("a change two levels down is seen through a detached intermediate computed", () => {
    const base = observable(1);
    const middle = observable((get) => get(base) + 1);
    const top = observable((get) => get(middle) * 10);
    const s = sub();
    expect(top.get(s)).toBe(20);
    cleanupEffect(s);
    base.set(4);
    expect(top.get(sub())).toBe(50);
  });

  test("an unobserved read never leaves the computed subscribed to its dependencies", () => {
    const source = observable(1);
    const value = observable((get) => get(source));
    value.get();
    value.get();
    expect(source.observers.size).toBe(0);
    const s = sub();
    value.get(s);
    cleanupEffect(s);
    expect(source.observers.size).toBe(0);
  });
});

/* ---------------------------------------------------------------------------
 * Theme set before first render / while unmounted
 * ------------------------------------------------------------------------- */

test("color scheme set before the first render applies to root variables", () => {
  registerCSS(`
:root { --fg: blue; }
@media (prefers-color-scheme: dark) { :root { --fg: red; } }
.themed { color: var(--fg); }`);
  act(() => {
    colorScheme.set("dark");
  });
  render(<View testID={testID} className="themed" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "red",
  });
});

test("color scheme changed while unmounted applies on remount", () => {
  registerCSS(`
:root { --fg: blue; }
@media (prefers-color-scheme: dark) { :root { --fg: red; } }
.themed { color: var(--fg); }`);
  const { unmount } = render(<View testID={testID} className="themed" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "blue",
  });
  unmount();
  act(() => {
    colorScheme.set("dark");
  });
  render(<View testID={testID} className="themed" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "red",
  });
});

/* ---------------------------------------------------------------------------
 * rules.ts — cached interaction flags vs. updateRules' early `return state`
 * ------------------------------------------------------------------------- */

test.each([
  ["hover", "hoverIn"],
  ["active", "pressIn"],
  ["focus", "focus"],
])(
  "adding a not-yet-matching %s: class to an unchanged rule set still wires handlers",
  (state, event) => {
    registerCSS(`.base { color: blue; } .later:${state} { color: red; }`);
    render(<View testID={testID} className="base" />);
    // Same matching rule set ⇒ same stylesObs ⇒ updateRules returns early.
    screen.rerender(<View testID={testID} className="base later" />);
    expect(screen.getByTestId(testID).props.style).toStrictEqual({
      color: "#00f",
    });
    fireEvent(screen.getByTestId(testID), event);
    expect(screen.getByTestId(testID).props.style).toStrictEqual({
      color: "#f00",
    });
  },
);

test("adding a group class to an unchanged rule set wires the container's handlers", () => {
  registerCSS(`
.base { color: blue; }
.child { color: blue; }
.group\\/card:active .child { color: red; }`);
  render(
    <View testID="parent" className="base">
      <View testID={testID} className="child" />
    </View>,
  );
  screen.rerender(
    <View testID="parent" className="base group/card">
      <View testID={testID} className="child" />
    </View>,
  );
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });
  fireEvent(screen.getByTestId("parent"), "pressIn");
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
});

/* ---------------------------------------------------------------------------
 * styles/index.ts — filterCssVariables identity cache
 * ------------------------------------------------------------------------- */

test("an inline style object mutated in place is re-read on re-render", () => {
  registerCSS(`.base { color: blue; }`);
  const style: Record<string, unknown> = { padding: 1 };
  render(<View testID={testID} className="base" style={style} />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual([
    { color: "#00f" },
    { padding: 1 },
  ]);
  style.padding = 2;
  screen.rerender(<View testID={testID} className="base" style={style} />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual([
    { color: "#00f" },
    { padding: 2 },
  ]);
});

test("a shared inline style object is not aliased between components", () => {
  registerCSS(`.base { color: blue; }`);
  const style = { padding: 1 };
  render(
    <>
      <View testID="a" className="base" style={style} />
      <View testID="b" style={style} />
    </>,
  );
  const a = screen.getByTestId("a").props.style;
  const b = screen.getByTestId("b").props.style;
  // Whatever the shape, mutating one component's output must not affect the other.
  const flat = (s: unknown): unknown =>
    Array.isArray(s) ? (s[s.length - 1] as unknown) : s;
  expect(flat(a)).not.toBe(style);
  expect(flat(b)).toEqual({ padding: 1 });
});

/* ---------------------------------------------------------------------------
 * styles/index.ts — computedTargets only for "contributing" configs
 * ------------------------------------------------------------------------- */

test("multi-config: inline vars in `style` never leak when only a later config has classes", () => {
  registerCSS(`.cc { padding: 2px; }`);
  render(
    <ScrollView
      testID={testID}
      style={[vars({ fg: "red" }), { margin: 4 }]}
      contentContainerClassName="cc"
    />,
  );
  const style = screen.getByTestId(testID).props.style;
  const items = (Array.isArray(style) ? style : [style]).flat(Infinity);
  for (const item of items) {
    if (item && typeof item === "object") {
      expect(Object.prototype.hasOwnProperty.call(item, VAR_SYMBOL)).toBe(
        false,
      );
    }
  }
});

test("multi-config: empty/undefined inline props with no classes don't clobber anything", () => {
  render(
    <ScrollView testID={testID} style={undefined} contentContainerStyle={{}} />,
  );
  const props = screen.getByTestId(testID).props;
  expect(props.className).toBeUndefined();
  expect(props.contentContainerClassName).toBeUndefined();
});

/* ---------------------------------------------------------------------------
 * api.tsx — mappingToConfig cached per mapping object
 * ------------------------------------------------------------------------- */

test("useCssElement with an inline mapping literal keeps working across renders", () => {
  registerCSS(`.a { color: blue; } .b { color: red; }`);
  function Inline(props: { className: string }) {
    // New mapping identity every render.
    return useCssElement(RNView, { ...props, testID }, { className: "style" });
  }
  render(<Inline className="a" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });
  screen.rerender(<Inline className="b" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
});
