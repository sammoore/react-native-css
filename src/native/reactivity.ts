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
  observers: Set<Effect>;
  run(): void;
};

export type Observable<Value, Arg = Value> = {
  observers: Set<Effect>;
  get: (effect?: Effect) => Value;
  set: (arg: Arg) => void;
  run: () => void;
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
    observers,
    run: () => {
      if (!isStatic) {
        const nextValue = (init as Read<Value, Arg>)(getter, lastArg);
        if (equality(value, nextValue)) {
          return;
        }
        value = nextValue;
      }

      notify();
    },
  };

  const getter: Getter = (observable) => observable.get(effect);

  function get(effect?: Effect) {
    if (effect) {
      observers.add(effect);
    }
    if (!didInit) {
      value = (init as Read<Value, Arg>)(getter, undefined);
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
      const nextValue = (init as Read<Value, Arg>)(getter, arg);

      didInit = true;
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
  };

  return obs;
}

export function cleanupEffect(effect: Effect) {
  if (!effect) return;
  for (const dep of effect.observers) {
    dep.observers.delete(effect);
  }
  effect.observers.clear();
}

/** Family Helpers ************************************************************/

export function family<Key, Result = Key, Args extends any = void>(
  fn: (key: Key, args: Args) => Result,
) {
  const map = new Map<Key, Result>();
  return Object.assign(
    (key: Key, args: Args) => {
      let value = map.get(key);
      if (!value) {
        value = fn(key, args);
        map.set(key, value);
      }
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
      let value = map.get(key);
      if (!value) {
        value = fn(key, args);
        map.set(key, value);
      }
      return value;
    },
    {
      has: (key: Key) => map.has(key),
    },
  );
}

/** Key-set cache **************************************************************/

/**
 * Every weak key gets a stable number. Numbering starts at 1 so no id is
 * falsy, whatever `weakFamily` does with falsy results.
 */
let weakKeyCount = 1;
const weakKeyId = weakFamily((_key: WeakKey) => weakKeyCount++);

const MOD = 9007199254740871; // Largest prime within safe integer range 2^53
const PRIME = 31;

type KeySetEntry<Value> = {
  /** The entry's key ids, sorted ascending. */
  ids: number[];
  value: Value;
  next: KeySetEntry<Value> | undefined;
};

/**
 * A cache keyed by a SET of weak keys (`first` plus everything in `rest`),
 * independent of iteration order.
 *
 * The key set is folded into a number that only picks a bucket. Every hit is
 * then confirmed by comparing the full, sorted id list, and entries whose
 * folds collide are chained. So two different key sets can never share an
 * entry, but no string is built and nothing is allocated on a hit.
 *
 * This keys the resolved-style cache, where sharing an entry between two
 * different rule sets would render one element with another element's
 * styles.
 */
export function keySetCache<Value>() {
  const buckets = new Map<number, KeySetEntry<Value>>();
  // Reused scratch for the key set being looked up.
  const ids: number[] = [];
  let count = 0;
  let entries = 0;

  /** Load `first` and `rest` into `ids` (sorted) and return their fold. */
  function load(first: WeakKey, rest: Iterable<WeakKey>) {
    let hash = 0;
    let product = 1;
    count = 0;

    let id = weakKeyId(first);
    ids[count++] = id;
    hash = (hash ^ id) % MOD;
    product = (product * (id + PRIME)) % MOD;

    for (const key of rest) {
      id = weakKeyId(key);
      hash = (hash ^ id) % MOD;
      product = (product * (id + PRIME)) % MOD;
      // Insertion sort: key sets are small, and this avoids a comparator call.
      let j = count - 1;
      while (j >= 0 && ids[j]! > id) {
        ids[j + 1] = ids[j]!;
        j--;
      }
      ids[j + 1] = id;
      count++;
    }

    return (hash + product) % MOD;
  }

  function matches(entry: KeySetEntry<Value>) {
    const stored = entry.ids;
    if (stored.length !== count) return false;
    for (let i = 0; i < count; i++) {
      if (stored[i] !== ids[i]) return false;
    }
    return true;
  }

  function remove(hash: number, entry: KeySetEntry<Value>) {
    let previous: KeySetEntry<Value> | undefined;
    for (let e = buckets.get(hash); e; previous = e, e = e.next) {
      if (e !== entry) continue;
      if (previous) {
        previous.next = e.next;
      } else if (e.next) {
        buckets.set(hash, e.next);
      } else {
        buckets.delete(hash);
      }
      entries--;
      return;
    }
  }

  return {
    /**
     * Return the value cached for this key set, creating it if needed.
     * `create` receives a `release` callback that removes the entry again.
     */
    get(
      first: WeakKey,
      rest: Iterable<WeakKey>,
      create: (release: () => void) => Value,
    ): Value {
      const hash = load(first, rest);

      for (let e = buckets.get(hash); e; e = e.next) {
        if (matches(e)) return e.value;
      }

      const entry: KeySetEntry<Value> = {
        ids: ids.slice(0, count),
        value: undefined as Value,
        next: buckets.get(hash),
      };
      buckets.set(hash, entry);
      entries++;
      entry.value = create(() => remove(hash, entry));
      return entry.value;
    },
    /** Number of live entries, and of buckets they occupy. */
    size() {
      return { entries, buckets: buckets.size };
    },
  };
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

export const colorScheme = observable<ColorSchemeName>(
  Appearance.getColorScheme(),
);
Appearance.addChangeListener((event) => colorScheme.set(event.colorScheme));

/** Containers ****************************************************************/

export type ContainerContextValue = Record<string, WeakKey>;
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
    return read(containerLayoutFamily(key))?.width || 0;
  });
});
