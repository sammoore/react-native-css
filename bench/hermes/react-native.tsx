/* eslint-disable */
/**
 * A minimal stand-in for `react-native`, for running the bench outside jest
 * (on Hermes or Node). There is no native side: View and Text render host
 * components the way React Native's jest mocks do (a class component that
 * copies its props onto a "View"/"Text" host element), and the APIs the
 * runtime reads (Appearance, Dimensions, PixelRatio, Platform, StyleSheet,
 * ...) return the same fixed values as the jest setup.
 *
 * Pressable is simplified: React Native's real Pressable (which jest does not
 * mock) runs its Pressability state machine on every render, so the absolute
 * cost of the `active:` scenario is lower here than under jest. It is the
 * same for every commit and engine, so comparisons between them still hold.
 */
import {
  Component,
  createElement,
  forwardRef,
  useState,
  type ReactNode,
} from "react";

function hostComponent(name: string) {
  class Host extends Component<any> {
    static displayName = name;
    render(): ReactNode {
      // As @react-native/jest-preset's mockComponent: drop undefined props.
      const props: Record<string, unknown> = {};
      for (const key of Object.keys(this.props)) {
        if (this.props[key] !== undefined) props[key] = this.props[key];
      }
      return createElement(name, props, this.props.children);
    }
  }
  return Host;
}

export const View = hostComponent("View");
export const Text = hostComponent("Text");
export const TextInput = hostComponent("TextInput");
export const Image = hostComponent("Image");
export const ImageBackground = hostComponent("ImageBackground");
export const ScrollView = hostComponent("ScrollView");
export const Switch = hostComponent("Switch");
export const ActivityIndicator = hostComponent("ActivityIndicator");
export const KeyboardAvoidingView = hostComponent("KeyboardAvoidingView");
export const TouchableOpacity = hostComponent("TouchableOpacity");
export const TouchableHighlight = hostComponent("TouchableHighlight");
export const TouchableWithoutFeedback = hostComponent(
  "TouchableWithoutFeedback",
);
export const Button = hostComponent("Button");
export const FlatList = hostComponent("FlatList");
export const VirtualizedList = hostComponent("VirtualizedList");

export const Pressable = forwardRef<any, any>(function Pressable(
  { children, style, onPressIn, onPressOut, ...rest },
  ref,
) {
  const [pressed, setPressed] = useState(false);
  return createElement(
    "View",
    {
      ...rest,
      ref,
      style: typeof style === "function" ? style({ pressed }) : style,
      onPressIn: (event: unknown) => {
        setPressed(true);
        onPressIn?.(event);
      },
      onPressOut: (event: unknown) => {
        setPressed(false);
        onPressOut?.(event);
      },
    },
    typeof children === "function" ? children({ pressed }) : children,
  );
});

function flatten(style: any): any {
  if (!Array.isArray(style)) return style ?? undefined;
  const result: Record<string, unknown> = {};
  for (const item of style) {
    const flat = flatten(item);
    if (flat) Object.assign(result, flat);
  }
  return result;
}

export const StyleSheet = {
  hairlineWidth: 1,
  absoluteFill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  absoluteFillObject: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  create: <T,>(styles: T) => styles,
  flatten,
  compose: (a: unknown, b: unknown) => (a && b ? [a, b] : (a ?? b)),
};

type Listener = (value: any) => void;
function emitter() {
  const listeners = new Set<Listener>();
  return {
    emit: (value: unknown) => listeners.forEach((listener) => listener(value)),
    add: (listener: Listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}

let colorScheme: "light" | "dark" | null = "light";
const appearanceEvents = emitter();
export const Appearance = {
  getColorScheme: () => colorScheme,
  setColorScheme: (scheme: "light" | "dark" | "unspecified" | null) => {
    colorScheme = scheme === "unspecified" ? null : scheme;
    appearanceEvents.emit({ colorScheme });
  },
  addChangeListener: appearanceEvents.add,
};

// The window React Native's jest setup reports.
const window = { width: 750, height: 1334, scale: 2, fontScale: 2 };
const dimensionEvents = emitter();
export const Dimensions = {
  get: (_dim: "window" | "screen") => window,
  set: () => {},
  addEventListener: (_type: string, listener: Listener) =>
    dimensionEvents.add(listener),
};

export const PixelRatio = {
  get: () => window.scale,
  getFontScale: () => window.fontScale,
  getPixelSizeForLayoutSize: (size: number) => Math.round(size * window.scale),
  roundToNearestPixel: (size: number) =>
    Math.round(size * window.scale) / window.scale,
};

export const Platform = {
  OS: "ios" as const,
  Version: "18.0",
  isPad: false,
  isTV: false,
  select: (specifics: Record<string, unknown>) =>
    "ios" in specifics
      ? specifics.ios
      : "native" in specifics
        ? specifics.native
        : specifics.default,
};

export const PlatformColor = (...names: string[]) => ({
  semantic: names,
});

export const I18nManager = {
  isRTL: false,
  doLeftAndRightSwapInRTL: true,
  allowRTL: () => {},
  forceRTL: () => {},
  getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: true }),
};

export const useColorScheme = () => colorScheme;
export const useWindowDimensions = () => window;

export default {
  View,
  Text,
  Pressable,
  StyleSheet,
  Appearance,
  Dimensions,
  PixelRatio,
  Platform,
  PlatformColor,
  I18nManager,
};
