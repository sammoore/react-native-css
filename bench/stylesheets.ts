/* eslint-disable */
/**
 * The stylesheets the suite can run against, selected with BENCH_CSS:
 *
 * - plain (default): hand-written CSS with one simple rule per class. Fast to
 *   build, and identical input for every library under test.
 * - tailwind: real Tailwind CSS v4 output with NativeWind's theme, for the
 *   same class names. This is what a NativeWind v5 app ships: rem-based
 *   values, variables (e.g. font weight and text color utilities declare
 *   their own) and runtime-computed declarations. NativeWind v4 is built on
 *   Tailwind CSS v3, so Tailwind v4 output is v5 only (see nw4.bench.tsx).
 *
 * Both define every class the suite uses, so results are directly
 * comparable between them.
 */
import { buildTailwindCss, largeClassList } from "./tailwind";

export type StylesheetName = "plain" | "tailwind";

export const STYLESHEET: StylesheetName = (() => {
  const name = process.env.BENCH_CSS ?? "plain";
  if (name !== "plain" && name !== "tailwind") {
    throw new Error(`BENCH_CSS must be "plain" or "tailwind", got "${name}"`);
  }
  return name;
})();

export interface Expected {
  padding: number;
  borderRadius: number;
}

export interface Stylesheet {
  name: StylesheetName;
  css: string;
  /**
   * Resolved values the suite's sanity checks expect, given the library's
   * pixels per rem (Tailwind sizes are rem-based; plain CSS uses px).
   */
  expected: (rem: number) => Expected;
}

/**
 * The nth class with a rule of its own, so no two share a rule set (see the
 * "unique rule sets" scenarios).
 */
export const uniqueClass = (n: number) => `mt-[${n}px]`;

function plainCss(uniqueClassCount: number) {
  return `
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

  .bg-red-500 { background-color: #ef4444; }
  .active\\:opacity-50:active { opacity: 0.5; }
  @media (min-width: 768px) { .md\\:flex-row { flex-direction: row; } }
  ${Array.from(
    { length: uniqueClassCount },
    (_, i) => `.mt-\\[${i}px\\] { margin-top: ${i}px; }`,
  ).join("\n  ")}
`;
}

/**
 * Project colors for Tailwind. The suite sets the real values with vars() on
 * its root View, so these defaults are deliberately different: the sanity
 * checks then confirm the vars() values won.
 *
 * The dark-mode block matters. The compiler inlines any variable declared
 * exactly once, which would turn these utilities into static colors and skip
 * runtime variable resolution entirely. A themed app declares its colors for
 * light and dark, so they stay variables, as they do here.
 */
const TAILWIND_THEME = `
@theme {
  --color-primary: #ff00ff;
  --color-gray: #ff00ff;
  --color-typography: #ff00ff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #111111;
    --color-gray: #111111;
    --color-typography: #111111;
  }
}
`;

/**
 * Load the selected stylesheet. `classNames` are the class strings the suite
 * uses, so Tailwind generates exactly those utilities, and uniqueClassCount is
 * how many uniqueClass(n) rules to define.
 */
export async function loadStylesheet(
  classNames: string[],
  uniqueClassCount: number,
): Promise<Stylesheet> {
  if (STYLESHEET === "plain") {
    return {
      name: "plain",
      css: plainCss(uniqueClassCount),
      expected: () => ({ padding: 16, borderRadius: 16 }),
    };
  }

  const classes = new Set(
    classNames.flatMap((className) => className.split(/\s+/)).filter(Boolean),
  );
  for (let n = 0; n < uniqueClassCount; n++) classes.add(uniqueClass(n));

  return {
    name: "tailwind",
    css: await buildTailwindCss([...classes], TAILWIND_THEME),
    // Tailwind's theme: --spacing is 0.25rem (p-4 is 4 × spacing) and
    // --radius-2xl is 1rem.
    expected: (rem) => ({ padding: 4 * 0.25 * rem, borderRadius: 1 * rem }),
  };
}

/** Escape a class name for use in a CSS selector. */
const selector = (className: string) =>
  "." + className.replace(/[:[\]%.\/]/g, (char) => `\\${char}`);

/** A stable hex color derived from a class name. */
function colorFor(className: string) {
  let hash = 0;
  for (const char of className) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `#${(hash & 0xffffff).toString(16).padStart(6, "0")}`;
}

const SPACING: Record<string, string[]> = {
  p: ["padding"],
  px: ["padding-left", "padding-right"],
  py: ["padding-top", "padding-bottom"],
  pt: ["padding-top"],
  pb: ["padding-bottom"],
  m: ["margin"],
  mx: ["margin-left", "margin-right"],
  my: ["margin-top", "margin-bottom"],
  mt: ["margin-top"],
  mb: ["margin-bottom"],
  gap: ["gap"],
  w: ["width"],
  h: ["height"],
};

const COLOR_PROPERTIES: Record<string, string> = {
  bg: "background-color",
  text: "color",
  border: "border-color",
};

/** A plain rule for one of largeClassList()'s classes. */
function plainRule(className: string) {
  const dark = className.startsWith("dark:");
  const name = dark ? className.slice("dark:".length) : className;
  const [prefix, ...rest] = name.split("-");
  let declarations: string;

  if (prefix && COLOR_PROPERTIES[prefix] && rest.length === 2) {
    declarations = `${COLOR_PROPERTIES[prefix]}: ${colorFor(className)};`;
  } else if (prefix && SPACING[prefix] && rest.length === 1) {
    const px = Number(rest[0]) * 4;
    declarations = SPACING[prefix].map((p) => `${p}: ${px}px;`).join(" ");
  } else {
    // Miscellaneous layout and typography utilities: any static declaration
    // serves for measuring load cost.
    declarations = "opacity: 0.5;";
  }

  const rule = `${selector(className)} { ${declarations} }`;
  return dark ? `@media (prefers-color-scheme: dark) { ${rule} }` : rule;
}

/**
 * A large stylesheet for the startup benchmark: about 2,000 classes, as
 * plain CSS or Tailwind output depending on BENCH_CSS.
 */
export async function loadLargeStylesheet() {
  const classes = largeClassList();
  const css =
    STYLESHEET === "plain"
      ? classes.map(plainRule).join("\n")
      : await buildTailwindCss(classes);
  return { name: STYLESHEET, css, classes: classes.length };
}
