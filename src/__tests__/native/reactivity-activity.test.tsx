import { Activity } from "react";

import { act, render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * <Activity> lifecycle regression tests for the subscription reconnect in
 * useNativeCss.
 *
 * React 19.2's <Activity mode="hidden"> renders its children but does not
 * mount their effects. When the boundary becomes visible, React re-renders
 * the children, re-creates their effects, and — critically — does NOT re-run
 * any state initializers. useNativeCss's state initializer (which runs
 * updateRules and subscribes ruleEffect) therefore runs at a different time
 * than the first effect setup, and observable conditions may have changed in
 * between.
 *
 * The reconnect effect in useNativeCss must re-establish subscriptions
 * against CURRENT observable state at the moment effects (re-)mount.
 */

function Fixture({ className }: { className: string }) {
  return <View testID={testID} className={className} />;
}

function ActivityFixture({
  hidden,
  className,
}: {
  hidden: boolean;
  className: string;
}) {
  return (
    <Activity mode={hidden ? "hidden" : "visible"}>
      <Fixture className={className} />
    </Activity>
  );
}

test("pre-rendered hidden Activity shows current styles on first show and stays reactive", () => {
  registerCSS(`
.audit-activity-prerender { color: blue; }

@media (prefers-color-scheme: dark) {
  .audit-activity-prerender { color: red; }
}
`);

  const screen = render(
    <ActivityFixture hidden className="audit-activity-prerender" />,
  );

  // Show: effects mount for the first time. Nothing changed while hidden,
  // so the initial styles must be correct...
  screen.rerender(
    <ActivityFixture hidden={false} className="audit-activity-prerender" />,
  );
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });

  // ...and the re-established subscriptions must be live, not just initially
  // correct.
  act(() => {
    colorScheme.set("dark");
  });
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });

  screen.unmount();
});

test("applies condition changes made while pre-rendered hidden, before first show", () => {
  registerCSS(`
.audit-activity-stale { color: blue; }

@media (prefers-color-scheme: dark) {
  .audit-activity-stale { color: red; }
}
`);

  const screen = render(
    <ActivityFixture hidden className="audit-activity-stale" />,
  );

  // The state initializer ran during the hidden render (matching rules
  // against the light scheme). Conditions change AFTER the initializer but
  // BEFORE the first effect mount.
  act(() => {
    colorScheme.set("dark");
  });

  screen.rerender(
    <ActivityFixture hidden={false} className="audit-activity-stale" />,
  );

  // The first commit must re-evaluate rules against current conditions —
  // not the conditions captured by the initializer.
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });

  screen.unmount();
});

test("unrelated condition changes during the pre-render window do not force a catch-up render", () => {
  registerCSS(`
.audit-activity-unrelated { color: blue; }
`);

  // This component has no conditional rules, so the color scheme observable
  // is NOT among its recorded dependencies. Flipping it while the boundary
  // is hidden is unrelated observable activity inside the initializer→commit
  // window. The fresh-mount reconnect should stay on the cheap replay path.
  let renders = 0;
  function CountingFixture({ className }: { className: string }) {
    renders++;
    return <View testID={testID} className={className} />;
  }

  const screen = render(
    <Activity mode="hidden">
      <CountingFixture className="audit-activity-unrelated" />
    </Activity>,
  );

  expect(renders).toBe(1);

  act(() => {
    colorScheme.set("dark");
  });

  screen.rerender(
    <Activity mode="visible">
      <CountingFixture className="audit-activity-unrelated" />
    </Activity>,
  );

  // Styles are still resolved correctly through the replayed subscriptions.
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });

  // Exactly one render pass for the show — no forced catch-up render.
  expect(renders).toBe(2);

  screen.unmount();
});

test("applies condition changes made while hidden, after a visible mount (mid-life replay)", () => {
  registerCSS(`
.audit-activity-midlife { color: blue; }

@media (prefers-color-scheme: dark) {
  .audit-activity-midlife { color: red; }
}
`);

  const screen = render(
    <ActivityFixture hidden={false} className="audit-activity-midlife" />,
  );
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });

  // Hiding preserves state but unmounts effects (detaching subscriptions).
  screen.rerender(
    <ActivityFixture hidden className="audit-activity-midlife" />,
  );

  act(() => {
    colorScheme.set("dark");
  });

  // Showing re-mounts effects. The reconnect must catch up on changes that
  // happened while the component was unsubscribed.
  screen.rerender(
    <ActivityFixture hidden={false} className="audit-activity-midlife" />,
  );
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });

  screen.unmount();
});
