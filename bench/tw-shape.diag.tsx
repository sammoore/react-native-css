/* eslint-disable */
/**
 * Diagnostic, not a benchmark: compiles common Tailwind v4 utilities through
 * react-native-css and reports the runtime shape of each class, which helps
 * explain benchmark results:
 * - SETS-VARS: declares CSS variables, so the component provides a variable
 *   context to its children
 * - container: declares a container, so the component provides a container
 *   context (see group.bench.tsx)
 * - reads-vars: resolves CSS variables at runtime
 * - conditional: media, pseudo-class, attribute or container conditions
 * - dynamic-decl: declarations computed at runtime (functions, units)
 * - animated: animations or transitions
 *
 * Run with `yarn bench:tw-shape`. Set TW_CLASSES to inspect your own list.
 */
import { compile } from "react-native-css/compiler";

import { buildTailwindCss } from "./tailwind";

const DEFAULT_CLASSES = [
  // layout / spacing / colors
  "flex-1 flex-row items-center justify-between gap-2 p-4 px-4 py-2 m-2 mt-4 w-full h-12 size-10",
  "bg-white bg-red-500 bg-black/50 text-white text-gray-900 text-red-500/80 border-gray-200",
  // typography
  "text-sm text-base text-lg text-2xl font-bold font-semibold font-medium leading-6 tracking-wide italic underline uppercase text-center",
  // borders / radius
  "border border-2 border-t rounded rounded-lg rounded-full",
  // effects
  "shadow shadow-md shadow-lg opacity-50",
  // transforms
  "rotate-45 scale-95 translate-x-2 -translate-y-1",
  // dark mode / responsive / state
  "dark:bg-gray-900 dark:text-white md:flex-row active:opacity-80 focus:border-blue-500 disabled:opacity-50",
  // containers
  "group group/card @container",
  // gradients / misc
  "bg-linear-to-r from-blue-500 to-purple-500 ring-2 ring-blue-500 elevation-md",
].join(" ");

const CLASSES = (process.env.TW_CLASSES ?? DEFAULT_CLASSES)
  .split(/\s+/)
  .filter(Boolean);

test("tailwind utility shapes", async () => {
  const sheet = compile(await buildTailwindCss(CLASSES), {}).stylesheet();
  const rules = new Map(sheet.s ?? []);

  const counts = {
    setsVars: 0,
    container: 0,
    readsVars: 0,
    conditional: 0,
    dynamic: 0,
    animated: 0,
    noNativeRule: 0,
  };
  const lines: string[] = [];

  for (const name of CLASSES) {
    const ruleSet = rules.get(name) as any[] | undefined;
    if (!ruleSet) {
      counts.noNativeRule++;
      lines.push(`${name.padEnd(24)} (no native rule)`);
      continue;
    }

    const flags = new Set<string>();
    for (const rule of ruleSet) {
      if (rule.v) {
        flags.add(`SETS-VARS[${rule.v.map((v: any) => v[0]).join(",")}]`);
      }
      if (rule.c) flags.add("container");
      if (rule.dv) flags.add("reads-vars");
      if (rule.m || rule.p || rule.aq || rule.cq) flags.add("conditional");
      if (rule.a) flags.add("animated");
      if ((rule.d ?? []).some(Array.isArray)) flags.add("dynamic-decl");
    }

    const flagList = [...flags];
    if (flagList.some((flag) => flag.startsWith("SETS-VARS")))
      counts.setsVars++;
    if (flags.has("container")) counts.container++;
    if (flags.has("reads-vars")) counts.readsVars++;
    if (flags.has("conditional")) counts.conditional++;
    if (flags.has("dynamic-decl")) counts.dynamic++;
    if (flags.has("animated")) counts.animated++;
    lines.push(`${name.padEnd(24)} ${flagList.join(" ") || "static"}`);
  }

  console.log(
    [
      ...lines,
      "",
      `${JSON.stringify(counts)} of ${CLASSES.length} classes`,
      `rootVariables=${sheet.vr?.length ?? 0} universalVariables=${sheet.vu?.length ?? 0}`,
    ].join("\n"),
  );

  expect(rules.size).toBeGreaterThan(0);
}, 120_000);
