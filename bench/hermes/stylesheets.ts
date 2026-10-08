/* eslint-disable */
/**
 * Stands in for ../stylesheets.ts when the suite runs as a plain script.
 * build.mjs builds the CSS (and compiles it) in Node with the real module;
 * this only provides the names and expected values the suite reads.
 */
export type StylesheetName = "plain" | "tailwind";

export const STYLESHEET = (process.env.BENCH_CSS ?? "plain") as StylesheetName;

export interface Expected {
  padding: number;
  borderRadius: number;
}

export interface StylesheetSource {
  name: StylesheetName;
  css: string;
  tailwind?: { classes: string[]; theme: string };
}

export interface Stylesheet extends StylesheetSource {
  expected: (rem: number) => Expected;
}

export const uniqueClass = (n: number) => `mt-[${n}px]`;

export async function loadStylesheet(): Promise<Stylesheet> {
  return {
    name: STYLESHEET,
    css: "",
    expected:
      STYLESHEET === "plain"
        ? () => ({ padding: 16, borderRadius: 16 })
        : (rem) => ({ padding: 4 * 0.25 * rem, borderRadius: 1 * rem }),
  };
}
