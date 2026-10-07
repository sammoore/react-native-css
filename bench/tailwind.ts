/**
 * Builds real Tailwind CSS v4 output with NativeWind's theme (see
 * nativewind-theme.css), so benchmarks and diagnostics work with the rules a
 * NativeWind app actually ships rather than hand-written CSS.
 */
import { readFileSync } from "fs";
import { join } from "path";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

const THEME_PATH = join(__dirname, "nativewind-theme.css");
const THEME = readFileSync(THEME_PATH, "utf8");

/**
 * Generate CSS for exactly `classes`. `@source inline(...)` keeps the output
 * independent of content scanning.
 */
export async function buildTailwindCss(classes: string[]) {
  const input = [
    `@import "tailwindcss/theme.css" layer(theme);`,
    `@import "tailwindcss/utilities.css" layer(utilities) source(none);`,
    THEME,
    ...classes.map((name) => `@source inline("${name}");`),
  ].join("\n");

  const { css } = await postcss([
    // Tailwind caches compiled candidates; a unique base avoids reusing them.
    tailwind({ base: `${Date.now()}-${Math.random()}` }),
  ]).process(input, { from: THEME_PATH });

  return css;
}

/** A broad, realistic utility set: ~2,000 classes. */
export function largeClassList() {
  const colors = [
    "slate",
    "gray",
    "zinc",
    "neutral",
    "stone",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
  ];
  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const spacing = [
    "p",
    "px",
    "py",
    "pt",
    "pb",
    "m",
    "mx",
    "my",
    "mt",
    "mb",
    "gap",
    "w",
    "h",
  ];
  const classes: string[] = [];
  for (const color of colors) {
    for (const shade of shades) {
      for (const prefix of ["bg", "text", "border"]) {
        classes.push(`${prefix}-${color}-${shade}`);
      }
    }
    classes.push(`dark:bg-${color}-900`, `dark:text-${color}-900`);
  }
  for (let i = 0; i <= 96; i++) {
    for (const prefix of spacing) classes.push(`${prefix}-${i}`);
  }
  classes.push(
    ..."flex flex-1 flex-row flex-col items-center justify-center justify-between rounded rounded-lg rounded-full shadow shadow-md font-bold font-semibold text-sm text-base text-lg text-xl leading-6 tracking-wide".split(
      " ",
    ),
  );
  return classes;
}
