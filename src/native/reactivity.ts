/* eslint-disable */
import { createContext } from "react";
import {
  Appearance,
  Dimensions,
  type ColorSchemeName,
  type LayoutRectangle,
} from "react-native";

import type { StyleDescriptor } from "react-native-css/compiler";

export type Effect = {
  observers: Set<Observable<any, any>>;
  run(): void;
  /**
   * PERF: the dependency set recorded by the most recent cleanupEffect().
   * Lets the owning component replay subscriptions cheaply instead of
   * re-running a full rule pass (see useNativeCss's reconnect effect).
   */
  dependencies?: Observable<any, any>[];
  /**
   * PERF: [observable, value-at-detach] pairs recorded by the most recent
   * cleanupEffect(). Lets useNativeCss's fresh-mount reconnect detect
   * whether any condition the component's rule matching actually read has
   * changed between the initializer and the commit effect (see
   * hasChangedDependencies).
   */
  snapshots?: [Observable<any, any>, unknown][];
};

export type Observable<Value, Arg = Value> = {
  observers: Set<Effect>;
  get: (effect?: Effect) => Value;
  set: (arg: Arg) => void;
  run: () => void;
  unsubscribe: (effect: Effect) => void;
};
type Read<Value, Arg> = (get: Getter, arg?: Arg) => Value;
export type Getter = <Value>(observable: Observable<Value, any>) => Value;

export const observableBatch: {
  current?: Set<Effect>;
} = {};

export function observable<Value, Arg = Value>(
  init: Value | Read<Value, Arg>,
  equality: (value1: Value, value2: Value) => boolean = Object.is,
) {
  let value: Value;
  let isStatic = typeof init !== "function";
  let didInit: boolean | undefined;
  let lastArg: Arg | undefined;

  if (typeof init !== "function") {
    value = init;
    didInit = true;
  }

  const observers = new Set<Effect>();
  const effect: Effect = {
    observers: new Set(),
    run: () => {
      if (!isStatic) {
        cleanupEffect(effect);
        const nextValue = (init as Read<Value, Arg>)(getter, lastArg);
        if (equality(value, nextValue)) {
          return;
        }
        value = nextValue;
      }

      notify();
    },
  };

  const getter: Getter = (observable) =>
    observable.get(observers.size > 0 ? effect : undefined);

  function get(subscriber?: Effect) {
    if (subscriber) {
      if (observers.size === 0 && !isStatic) didInit = false;
      observers.add(subscriber);
      subscriber.observers.add(obs);
    }
    if (!didInit) {
      cleanupEffect(effect);
      value = (init as Read<Value, Arg>)(getter, lastArg);
      didInit = observers.size > 0;
    }

    return value;
  }

  function set(arg: Arg) {
    if (isStatic) {
      if (equality(value, arg as unknown as Value)) {
        return;
      }
      value = arg as unknown as Value;
    } else {
      cleanupEffect(effect);
      const nextValue = (init as Read<Value, Arg>)(getter, arg);

      didInit = observers.size > 0;
      lastArg = arg;

      if (equality(value, nextValue)) {
        return;
      }
      value = nextValue;
    }

    notify();

    return obs;
  }

  function notify() {
    Array.from(observers).forEach((observer) => {
      if (observableBatch.current) {
        observableBatch.current.add(observer);
      } else {
        observer.run();
      }
    });
  }

  const obs: Observable<Value, Arg> = {
    observers,
    get,
    set,
    run: effect.run,
    unsubscribe(subscriber) {
      if (observers.delete(subscriber) && observers.size === 0 && !isStatic) {
        cleanupEffect(effect);
        didInit = false;
      }
      subscriber.observers.delete(obs);
    },
  };

  return obs;
}

export function cleanupEffect(effect: Effect) {
  if (!effect) return;
  // PERF: record the dependency set before detaching. Every effect setup is
  // immediately preceded by a cleanupEffect call on that effect (the state
  // initializer's discard or React's cleanup-then-setup replay), so this is
  // always the current set — see useNativeCss's reconnect effect.
  const dependencies = (effect.dependencies = Array.from(effect.observers));
  // PERF: capture each dependency's current value BEFORE detaching. While
  // this effect is still subscribed, computed observables return their
  // cached value (didInit is true), so this is O(deps) cheap reads, not
  // recomputations. Used by hasChangedDependencies.
  effect.snapshots = dependencies.map(
    (observable) =>
      [observable, observable.get()] as [Observable<any, any>, unknown],
  );
  effect.observers.clear();
  for (const dep of dependencies) {
    dep.unsubscribe(effect);
  }
}

/**
 * PERF: whether any dependency recorded by the most recent cleanupEffect()
 * changed value since it was detached.
 *
 * Scoping to the effect's own dependencies is what keeps the fresh-mount
 * fast path fast: unrelated observable activity elsewhere in the app
 * (another component's layout, interaction, or theme change) cannot cause
 * a false positive the way a global change counter would.
 *
 * The reads do not subscribe. A computed observable whose last subscriber
 * was just detached will recompute on read (didInit was reset by
 * unsubscribe), which is no more work than the full reconnect would have
 * performed anyway. Returns false when there is nothing to compare (an
 * effect that never subscribed, or one whose deps are unchanged).
 */
export function hasChangedDependencies(effect: Effect): boolean {
  const snapshots = effect.snapshots;
  if (!snapshots) return false;
  for (const [observable, value] of snapshots) {
    if (!Object.is(observable.get(), value)) return true;
  }
  return false;
}

/** Family Helpers ************************************************************/

export function family<Key, Result = Key, Args extends any = void>(
  fn: (key: Key, args: Args) => Result,
) {
  const map = new Map<Key, Result>();
  return Object.assign(
    (key: Key, args: Args) => {
      if (map.has(key)) return map.get(key)!;
      const value = fn(key, args);
      map.set(key, value);
      return value;
    },
    {
      delete(key: Key) {
        return map.delete(key);
      },
      clear() {
        return map.clear();
      },
    },
  );
}

type WeakFamilyFn<Key, Args = undefined, Result = Key> = ((
  key: Key,
  args: Args,
) => Result) & {
  has(key: Key): boolean;
};

export function weakFamily<Key extends WeakKey, Result = Key>(
  fn: (key: Key) => Result,
): WeakFamilyFn<Key, void, Result>;
export function weakFamily<Key extends WeakKey, Args = undefined, Result = Key>(
  fn: (key: Key, args: Args) => Result,
): WeakFamilyFn<Key, Args, Result>;
export function weakFamily<Key extends WeakKey, Args = undefined, Result = Key>(
  fn: (key: Key, args: Args) => Result,
): WeakFamilyFn<Key, Args, Result> {
  const map = new WeakMap<Key, Result>();
  return Object.assign(
    (key: Key, args: Args) => {
      if (map.has(key)) return map.get(key)!;
      const value = fn(key, args);
      map.set(key, value);
      return value;
    },
    {
      has: (key: Key) => map.has(key),
    },
  );
}

/********************************* Variables **********************************/

export const VAR_SYMBOL = Symbol.for("react-native-css.var");
export type VariableContextValue = Record<string, StyleDescriptor> & {
  [VAR_SYMBOL]: true;
};

/** Pseudo Classes ************************************************************/

export const hoverFamily = weakFamily(() => observable(false));
export const activeFamily = weakFamily(() => observable<boolean>(false));
export const focusFamily = weakFamily(() => observable<boolean>(false));

/** Dimensions ****************************************************************/

export const dimensions = observable(Dimensions.get("window"));
export const vw = observable<number>(
  (read, value) => value ?? read(dimensions)?.width,
);
export const vh = observable<number>(
  (read, value) => value ?? read(dimensions)?.height,
);

Dimensions.addEventListener("change", ({ window }) => {
  observableBatch.current = new Set();
  vw.set(window.width);
  vh.set(window.height);

  for (const effect of observableBatch.current) {
    effect.run();
  }

  observableBatch.current = undefined;
});

/** Color Scheme **************************************************************/

export const colorScheme = observable<ColorSchemeName | null | undefined>(
  Appearance.getColorScheme(),
);
Appearance.addChangeListener((event) => colorScheme.set(event.colorScheme));

/** Containers ****************************************************************/

export type ContainerContextValue = Record<
  string,
  {
    key: WeakKey;
    props: Record<string, unknown> | null | undefined;
  }
>;
export const ContainerContext = createContext<ContainerContextValue>({});

export const containerLayoutFamily = weakFamily(() => {
  return observable<LayoutRectangle>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
});

export const containerWidthFamily = weakFamily((key) => {
  return observable((read) => {
    return read(containerLayoutFamily(key))?.width || 0;
  });
});

export const containerHeightFamily = weakFamily((key) => {
  return observable((read) => {
    return read(containerLayoutFamily(key))?.height || 0;
  });
});
