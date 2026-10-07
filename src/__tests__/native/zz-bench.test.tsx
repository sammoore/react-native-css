/* eslint-disable */
/**
 * TEMPORARY performance benchmark — mount + render costs of the v5 runtime.
 * Compare with the equivalent file in ../nativewind@v4/packages/react-native-css-interop.
 */
import * as React from "react";
import { act, create } from "react-test-renderer";

import { View } from "react-native-css/components";
import { registerCSS } from "react-native-css/jest";

const CSS = `
  .flex-1 { flex: 1; }
  .flex-row { flex-direction: row; }
  .items-center { align-items: center; }
  .justify-center { justify-content: center; }
  .p-4 { padding: 16px; }
  .bg-red-500 { background-color: #ef4444; }
  .rounded { border-radius: 4px; }
  .w-full { width: 100%; }
  .active\\:opacity-50:active { opacity: 0.5; }
  @media (min-width: 768px) { .md\\:flex-row { flex-direction: row; } }
  .txt { color: #333333; font-size: 14px; line-height: 20px; font-weight: 600; }
`;

const N = 1000;
const CLASS_NAME =
  "flex-1 flex-row items-center justify-center p-4 bg-red-500 rounded w-full txt";
const INLINE_STYLE = { marginTop: 1 };

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function bench(label: string, fn: () => void, runs = 7) {
  // warmup
  fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    fn();
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  console.log(
    `${label}: median=${median(times).toFixed(3)}ms min=${Math.min(...times).toFixed(3)}ms`,
  );
}

function StyledApp() {
  const children = [];
  for (let i = 0; i < N; i++) {
    children.push(
      <View key={i} className={CLASS_NAME}>
        <View key="inner" className="flex-1 p-4" />
      </View>,
    );
  }
  return <View>{children}</View>;
}

function StyledAppWithInline() {
  const children = [];
  for (let i = 0; i < N; i++) {
    children.push(
      <View key={i} className="p-4 bg-red-500" style={INLINE_STYLE} />,
    );
  }
  return <View>{children}</View>;
}

function PlainApp() {
  const children = [];
  for (let i = 0; i < N; i++) {
    children.push(<View key={i} />);
  }
  return <View>{children}</View>;
}

test("bench mount + render", () => {
  registerCSS(CSS);

  // 1. Mount N styled components
  bench("styled mount (2x1000 components)", () => {
    let renderer: any;
    act(() => {
      renderer = create(<StyledApp />);
    });
    act(() => {
      renderer.unmount();
    });
  });

  // 2. Re-render with identical props (parent-driven)
  {
    let renderer: any;
    act(() => {
      renderer = create(<StyledApp />);
    });
    bench("styled re-render (same props)", () => {
      act(() => {
        renderer.update(<StyledApp />);
      });
    });
    act(() => {
      renderer.unmount();
    });
  }

  // 3. Re-render with a new inline style object identity
  {
    let renderer: any;
    let tick = 0;
    const App = () => {
      const children = [];
      for (let i = 0; i < N; i++) {
        children.push(
          <View
            key={i}
            className="p-4 bg-red-500"
            style={{ marginTop: tick + i }}
          />,
        );
      }
      return <View>{children}</View>;
    };
    act(() => {
      renderer = create(<App />);
    });
    bench("styled re-render (new inline style identity)", () => {
      act(() => {
        tick++;
        renderer.update(<App />);
      });
    });
    act(() => {
      renderer.unmount();
    });
  }

  // 4. Mount with className + inline style (deepMergeConfig path)
  bench("styled+inline mount", () => {
    let renderer: any;
    act(() => {
      renderer = create(<StyledAppWithInline />);
    });
    act(() => {
      renderer.unmount();
    });
  });

  // 5. Mount unstyled components (wrapped, no className)
  bench("plain wrapped mount (no className)", () => {
    let renderer: any;
    act(() => {
      renderer = create(<PlainApp />);
    });
    act(() => {
      renderer.unmount();
    });
  });
});

// 6. Baseline: raw react-native View (no CSS wrapper)
import { View as RawView } from "react-native";
function RawApp() {
  const children = [];
  for (let i = 0; i < N; i++) {
    children.push(<RawView key={i} />);
  }
  return <RawView>{children}</RawView>;
}
bench("RAW react-native mount (no wrapper)", () => {
  let renderer: any;
  act(() => {
    renderer = create(<RawApp />);
  });
  act(() => {
    renderer.unmount();
  });
});
{
  let renderer: any;
  act(() => {
    renderer = create(<RawApp />);
  });
  bench("RAW react-native re-render (same props)", () => {
    act(() => {
      renderer.update(<RawApp />);
    });
  });
  act(() => {
    renderer.unmount();
  });
}
