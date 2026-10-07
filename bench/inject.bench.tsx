/* eslint-disable */
/**
 * Startup cost of StyleCollection.inject for a large compiled Tailwind
 * stylesheet (~2,000 utilities), the work an app does once at launch and
 * again on every Fast Refresh.
 *
 * - cold: styles and keyframes cleared before each run, as at launch.
 * - re-inject unchanged: the same stylesheet injected over itself, as on a
 *   Fast Refresh that didn't change any CSS. Observables compare values deeply
 *   and skip unchanged rule sets.
 *
 * Each run injects freshly parsed objects, like a newly evaluated bundle; the
 * parse is not timed.
 */
import { compile } from "react-native-css/compiler";
import { StyleCollection } from "react-native-css/native-internal";

import { measure, report, RUNS, WARMUP_RUNS } from "./harness";
import { buildTailwindCss, largeClassList } from "./tailwind";

let json = "";
let ruleSets = 0;

beforeAll(async () => {
  const classes = largeClassList();
  const sheet = compile(await buildTailwindCss(classes), {}).stylesheet();
  ruleSets = sheet.s?.length ?? 0;
  json = JSON.stringify(sheet);
}, 120_000);

describe("StyleCollection.inject", () => {
  test("cold", () => {
    let data: any;
    const stats = measure(
      () => StyleCollection.inject(data),
      RUNS,
      WARMUP_RUNS,
      () => {
        data = JSON.parse(json);
        StyleCollection.styles.clear();
        StyleCollection.keyframes.clear();
      },
    );
    report("nw5", "inject, cold", stats, {
      ruleSets,
      jsonKB: Math.round(json.length / 1024),
    });
    expect(ruleSets).toBeGreaterThan(1000);
  });

  test("re-inject unchanged", () => {
    StyleCollection.inject(JSON.parse(json));
    let data: any;
    const stats = measure(
      () => StyleCollection.inject(data),
      RUNS,
      WARMUP_RUNS,
      () => {
        data = JSON.parse(json);
      },
    );
    report("nw5", "inject, re-inject unchanged", stats, { ruleSets });
  });
});
