/* eslint-disable */
/**
 * Builds the suite as one plain script that runs on Hermes (or Node) without
 * jest. See README.md.
 *
 *   node bench/hermes/build.mjs [--src <dir>] [--out <file>] [--filter <re>]
 *                               [--no-hbc]
 *
 * Reads the same variables as the jest bench: NODE_ENV (default production),
 * BENCH_CSS, BENCH_ITEMS, BENCH_RUNS, BENCH_WARMUP. They are baked into the
 * bundle, so rebuild after changing them.
 *
 * --src points `react-native-css` at another src/ directory, e.g. a worktree
 * at an older commit, to compare commits with the same bench code.
 *
 * BENCH_GC=1 adds a full collection before every timed run (see harness.ts).
 *
 * Steps:
 * 1. In Node, build the stylesheet with ../stylesheets.ts and compile it with
 *    the compiler under test (lightningcss is a native addon, so this can't
 *    run on Hermes; it is the bundler's work, never timed, anyway).
 * 2. Bundle entry.ts with the compiled artifact, React's production (or
 *    development) builds, react-test-renderer and the react-native stand-in.
 * 3. Lower syntax with React Native's Babel preset, as a release build does.
 * 4. Compile to Hermes bytecode (<out>.hbc) with the hermesc React Native
 *    ships, unless --no-hbc. HERMESC overrides the compiler.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = resolve(here, "../..");
const benchDir = join(root, "bench");

const { values: args } = parseArgs({
  options: {
    "src": { type: "string", default: join(root, "src") },
    "out": { type: "string", default: join(here, ".build", "bench.js") },
    "filter": { type: "string", default: "" },
    "no-hbc": { type: "boolean", default: false },
  },
});
const src = resolve(args.src);

process.env.NODE_ENV ??= "production";
const production = process.env.NODE_ENV === "production";
const RUNS = Number(process.env.BENCH_RUNS ?? 10);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 3);
const ITEMS = Number(process.env.BENCH_ITEMS ?? 1000);

/** `react-native-css[/sub]` → src/[sub], for the src/ under test. */
const selfAlias = {
  name: "self-alias",
  setup(build) {
    build.onResolve({ filter: /^react-native-css(\/.*)?$/ }, (a) => {
      const [, sub = ""] = a.path.match(/^react-native-css(\/.*)?$/);
      return build.resolve(`./${sub ? sub.slice(1) : "index"}`, {
        resolveDir: src,
        kind: a.kind,
      });
    });
  },
};

// This package's exports map lists "types" after "default"; irrelevant here.
const logOverride = { "package.json": "silent" };

const extensions = [
  ".native.tsx",
  ".native.ts",
  ".ios.tsx",
  ".ios.ts",
  ".tsx",
  ".ts",
  ".cts",
  ".native.js",
  ".ios.js",
  ".js",
  ".cjs",
  ".mjs",
  ".json",
];

// 1. The stylesheet artifact, built and compiled in Node.
mkdirSync(join(here, ".build"), { recursive: true });
const prebuildFile = join(here, ".build", "prebuild.cjs");
await esbuild.build({
  stdin: {
    contents: `
      import { CLASSES } from "./bench/classes";
      import { loadStylesheet } from "./bench/stylesheets";
      import { compile } from "react-native-css/compiler";
      export async function artifact(uniqueClassCount) {
        const sheet = await loadStylesheet(Object.values(CLASSES), uniqueClassCount);
        return JSON.stringify(compile(sheet.css, {}).stylesheet());
      }`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [selfAlias],
  outfile: prebuildFile,
  // bench/tailwind.ts reads files next to itself.
  define: { __dirname: JSON.stringify(benchDir) },
  logLevel: "warning",
  logOverride,
});
const { artifact: buildArtifact } = require(prebuildFile);
// As the suite: an initial render, warmup and timed runs, ITEMS each.
const artifact = await buildArtifact(ITEMS * (1 + WARMUP + RUNS));

// 2. The bundle.
const reactNativeShim = join(here, "react-native.tsx");
// The scheduler react-test-renderer itself resolves.
const schedulerDir = dirname(
  require.resolve("scheduler/package.json", {
    paths: [dirname(require.resolve("react-test-renderer/package.json"))],
  }),
);

const redirects = {
  name: "bench-redirects",
  setup(build) {
    // The shared suite's harness, libraries and stylesheets → ./hermes/*.
    build.onResolve({ filter: /^\.\/(harness|libraries|stylesheets)$/ }, (a) =>
      a.resolveDir === benchDir
        ? build.resolve(`./hermes/${a.path.slice(2)}`, {
            resolveDir: benchDir,
            kind: a.kind,
          })
        : undefined,
    );
    build.onResolve({ filter: /^react-native$/ }, () => ({
      path: reactNativeShim,
    }));
    // Only animated styles load Reanimated; the suite has none.
    build.onResolve(
      { filter: /^react-native-(reanimated|worklets)$/ },
      (a) => ({
        path: a.path,
        namespace: "stub",
      }),
    );
    build.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
      contents: `throw new Error("${a.path} is not available in the bench bundle");`,
      loader: "js",
    }));
    // Production React has no act(); flush the mock scheduler instead, as
    // the jest bench config does.
    if (production) {
      build.onResolve({ filter: /^scheduler$/ }, () => ({
        path: join(schedulerDir, "unstable_mock.js"),
      }));
    }
    // The guard that throws when Metro isn't configured; Metro swaps it for
    // an empty module in apps (as does the jest bench config).
    build.onResolve({ filter: /react-native-css-metro-override$/ }, () => ({
      path: join(src, "metro", "override.ts"),
    }));
    build.onResolve({ filter: /^virtual:bench-artifact$/ }, (a) => ({
      path: a.path,
      namespace: "virtual",
    }));
    build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
      contents: `export default ${JSON.stringify(artifact)};`,
      loader: "js",
    }));
  },
};

const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key === "NODE_ENV" || key.startsWith("BENCH_")) env[key] = value;
}

const bundled = await esbuild.build({
  // globals.ts first: the suite reads jest's globals and process.env while
  // its module evaluates. (Kept out of entry.ts, where import sorting would
  // reorder it.)
  stdin: {
    contents: `import "./globals"; import "./entry";`,
    resolveDir: here,
    sourcefile: "bench-entry.ts",
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "neutral",
  mainFields: ["react-native", "main", "module"],
  conditions: ["react-native", "require", "default"],
  resolveExtensions: extensions,
  // Packages resolve from this checkout, even for a --src outside it.
  nodePaths: [join(root, "node_modules")],
  // Syntax is lowered below, the way an app's release build lowers it.
  target: "esnext",
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
    "__BENCH_ENV__": JSON.stringify(env),
    "__BENCH_FILTER__": JSON.stringify(args.filter),
  },
  plugins: [selfAlias, redirects],
  logLevel: "warning",
  logOverride,
  legalComments: "none",
});

/**
 * Run the bundle through React Native's Babel preset with the transform
 * profile a release build on Hermes V1 uses, so the engine sees the same code
 * shapes an app ships: let/const and destructuring lowered, async functions
 * as generators, classes, spread and for-of left native.
 */
const babel = require("@babel/core");
const presetPath = createRequire(
  require.resolve("react-native/package.json"),
).resolve("@react-native/babel-preset");
const { code } = await babel.transformAsync(bundled.outputFiles[0].text, {
  babelrc: false,
  configFile: false,
  compact: true,
  sourceType: "script",
  caller: { name: "metro", unstable_transformProfile: "hermes-stable" },
  presets: [
    [
      presetPath,
      {
        dev: !production,
        disableImportExportTransform: true,
        // Inline helpers: the bundle has no module system to require them.
        enableBabelRuntime: false,
        unstable_transformProfile: "hermes-stable",
      },
    ],
  ],
});
const out = resolve(args.out);
writeFileSync(out, code);

let hbc;
if (!args["no-hbc"]) {
  hbc = out.replace(/\.js$/, "") + ".hbc";
  const hermesc =
    process.env.HERMESC ??
    join(
      dirname(
        require.resolve("hermes-compiler/package.json", {
          paths: [dirname(require.resolve("react-native/package.json"))],
        }),
      ),
      "hermesc",
      { linux: "linux64-bin", darwin: "osx-bin", win32: "win64-bin" }[
        process.platform
      ],
      "hermesc",
    );
  // The bundle reads jest-style globals that globals.ts defines at runtime.
  execFileSync(hermesc, [
    "-O",
    "-emit-binary",
    "-Wno-undefined-variable",
    "-out",
    hbc,
    out,
  ]);
}

console.log(
  `built ${out}${hbc ? ` and ${hbc}` : ""} (src: ${src}, ` +
    `${process.env.NODE_ENV}, ${process.env.BENCH_CSS ?? "plain"} CSS, ` +
    `${ITEMS} items, BENCH_GC=${process.env.BENCH_GC ?? "0"})`,
);
