/* eslint-disable  */
import { useContext, useEffect, useState, type ComponentType } from "react";
import { Appearance, type ViewStyle } from "react-native";

import type { StyleDescriptor } from "react-native-css/compiler";
import { VariableContext } from "react-native-css/native-internal";

import type {
  ColorScheme,
  Props,
  ReactComponent,
  Styled,
  StyledConfiguration,
  StyledOptions,
} from "../runtime.types";
import { mappingToConfig, useNativeCss } from "./react/useNativeCss";
import { usePassthrough } from "./react/usePassthrough";
import {
  cleanupEffect,
  colorScheme as colorSchemeObs,
  VAR_SYMBOL,
  type Effect,
  type Getter,
} from "./reactivity";
import { resolveValue } from "./styles/resolve";

export {
  StyleCollection,
  VariableContext,
  VariableContextProvider,
} from "react-native-css/native-internal";

export { useNativeCss };

const defaultMapping: StyledConfiguration<ComponentType<{ style: unknown }>> = {
  className: "style",
};

/**
 * PERF: the mapping object is almost always a module-level constant shared by
 * every instance of a component (see `src/components/*.tsx`). Cache the
 * derived configs so each mount skips `mappingToConfig`'s allocations and
 * `useState`, and so all instances share one `configs` identity (better
 * `getRuleVariation` and `generateStateHash` cache hits).
 */
const mappingConfigCache = new WeakMap<
  StyledConfiguration<any>,
  ReturnType<typeof mappingToConfig>
>();

/**
 * Generates a new Higher-Order component the wraps the base component and applies the styles.
 * This is added to the `interopComponents` map so that it can be used in the `wrapJSX` function
 * @param baseComponent
 * @param mapping
 */
export const styled: Styled = (
  baseComponent: ReactComponent<any>,
  mapping: StyledConfiguration<any> = defaultMapping,
  options?: StyledOptions,
) => {
  let component: any;
  // const type = getComponentType(baseComponent);

  const configs = mappingToConfig(mapping);

  if (options?.passThrough) {
    component = (props: Record<string, any>) => {
      return usePassthrough(baseComponent, props, configs);
    };
  } else {
    component = (props: Record<string, any>) => {
      return useNativeCss(baseComponent, props, configs);
    };
  }

  const name = baseComponent.displayName ?? baseComponent.name ?? "unknown";
  component.displayName = `CssInterop.${name}`;
  return component;
};

export const colorScheme: ColorScheme = {
  get() {
    return colorSchemeObs.get() ?? Appearance.getColorScheme() ?? "light";
  },
  set(value) {
    return colorSchemeObs.set(value === "unspecified" ? null : value);
  },
};

export const useUnstableNativeVariable = useNativeVariable;

export const useCssElement = <
  const C extends ReactComponent<any>,
  const M extends StyledConfiguration<C>,
>(
  component: C,
  incomingProps: Props,
  mapping: M,
) => {
  let configs = mappingConfigCache.get(mapping);
  if (!configs) {
    configs = mappingToConfig(mapping);
    mappingConfigCache.set(mapping, configs);
  }
  return useNativeCss(component, incomingProps, configs);
};

export function useNativeVariable(name: string) {
  if (name.startsWith("--")) {
    name = name.slice(2);
  }

  const inheritedVariables = useContext(VariableContext);
  const [, forceUpdate] = useState(0);
  const [effect] = useState(() => {
    const effect: Effect = {
      observers: new Set(),
      run: () => forceUpdate((state) => state + 1),
    };

    const get: Getter = (observable) => observable.get(effect);

    return Object.assign(effect, { get });
  });

  useEffect(() => {
    // React StrictMode replays setup after cleanup without another render.
    if (effect.observers.size === 0) forceUpdate((state) => state + 1);
    return () => cleanupEffect(effect, false);
  }, [effect]);
  cleanupEffect(effect, false);
  return resolveValue([{}, "var", [name]], effect.get, { inheritedVariables });
}

/**
 * @deprecated Use `<VariableContextProvider />` instead.
 */
export function vars(variables: Record<string, StyleDescriptor>): ViewStyle {
  return Object.assign(
    { [VAR_SYMBOL]: "inline" },
    Object.fromEntries(
      Object.entries(variables).map(([k, v]) => [k.replace(/^--/, ""), v]),
    ),
  ) as ViewStyle;
}
