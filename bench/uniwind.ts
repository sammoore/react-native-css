/* eslint-disable */
/**
 * Builds a stylesheet the way Uniwind's Metro transformer does in an app,
 * without Metro.
 *
 * In an app, Uniwind's transformer compiles the CSS entry file into a module,
 * `Uniwind.__reinit(rt => ({ stylesheet: … }), themes)`, and hands it to
 * Metro's transform worker, which runs Babel and wraps it like any other JS
 * file. Here that worker is replaced by one that returns the code unchanged,
 * so the result is exactly the module Uniwind generates for the app. Only
 * Babel's pass over it is skipped.
 *
 * Uniwind's compiler is only reachable through that transformer: the package
 * exports nothing else that compiles native styles.
 */
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, relative } from "path";

import type { StylesheetSource } from "./stylesheets";

/** The installed uniwind package directory (BENCH_UNIWIND), symlinks resolved. */
export function uniwindDir() {
  return realpathSync(process.env.BENCH_UNIWIND!);
}

/**
 * Uniwind's CSS entry file for a stylesheet. Tailwind stylesheets are built
 * from their source with Uniwind's own theme, as an app would; plain CSS is
 * passed through as is.
 */
function entryCss(stylesheet: StylesheetSource) {
  if (!stylesheet.tailwind) return stylesheet.css;
  const { classes, theme } = stylesheet.tailwind;
  return [
    `@import "tailwindcss";`,
    `@import "uniwind";`,
    theme,
    ...classes.map((name) => `@source inline("${name}");`),
  ].join("\n");
}

/** Compile a stylesheet into the module Uniwind ships for native. */
export async function compileUniwind(stylesheet: StylesheetSource) {
  // Metro's transform worker, replaced: return the generated module as is,
  // in the shape Uniwind's transformer expects back.
  jest.doMock(
    "metro-transform-worker",
    () => ({
      transform: (
        _config: unknown,
        _root: unknown,
        _file: unknown,
        data: Buffer,
      ) => ({
        code: data.toString(),
        output: [{ data: {} }],
      }),
    }),
    { virtual: true },
  );
  const { transform } = require(
    join(uniwindDir(), "dist/metro/transformer.cjs"),
  );

  // The entry file goes in its own folder: Uniwind scans the entry's folder
  // for class names, and resolves `tailwindcss` and `uniwind` from it, so it
  // links to the folder uniwind is installed in.
  const folder = mkdtempSync(join(tmpdir(), "react-native-css-bench-uniwind-"));
  try {
    symlinkSync(dirname(uniwindDir()), join(folder, "node_modules"), "dir");
    const entry = join(folder, "global.css");
    writeFileSync(entry, entryCss(stylesheet));

    const result = await transform(
      {
        uniwind: {
          // Uniwind matches the entry file relative to the working directory.
          cssEntryFile: relative(process.cwd(), entry),
          // Otherwise written to the working directory.
          dtsFile: join(folder, "uniwind-types.d.ts"),
          isExpoProject: false,
          extraThemes: [],
        },
      },
      folder,
      "global.css",
      Buffer.from(""),
      { type: "module", platform: "ios", customTransformOptions: {} },
    );
    return result.code as string;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
