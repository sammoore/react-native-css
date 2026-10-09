import { keySetCache } from "../../native/reactivity";

/**
 * `keySetCache` keys the resolved-style cache. Two different rule sets sharing
 * one entry does not cost a cache miss: the second element renders the first
 * element's styles. Folds are allowed to collide (they only pick a bucket);
 * entries never are.
 */

/** Distinct weak keys. Any object is a valid one. */
const keysOf = (count: number): WeakKey[] =>
  Array.from({ length: count }, () => ({}));

const neverCreate = () => {
  throw new Error("expected a cache hit");
};

test("distinct key sets never share an entry, even when their folds collide", () => {
  const cache = keySetCache<string>();
  const first: WeakKey = {};
  const keys = keysOf(60);
  let pairs = 0;

  for (const [l, left] of keys.entries()) {
    for (const [offset, right] of keys.slice(l + 1).entries()) {
      const signature = `${String(l)}+${String(l + 1 + offset)}`;
      expect(cache.get(first, [left, right], () => signature)).toBe(signature);
      pairs++;
    }
  }

  const { entries, buckets } = cache.size();
  expect(entries).toBe(pairs);
  // Vacuity guard: some folds must have collided, or chaining went untested.
  expect(buckets).toBeLessThan(entries);
});

test("a key set finds the same entry however it is ordered", () => {
  const cache = keySetCache<object>();
  const [config, a, b, c] = keysOf(4) as [WeakKey, WeakKey, WeakKey, WeakKey];
  const value = cache.get(config, [a, b, c], () => ({}));

  expect(cache.get(config, [c, a, b], neverCreate)).toBe(value);
  expect(cache.get(config, new Set([b, c, a]), neverCreate)).toBe(value);
});

test("a subset or superset is a different entry", () => {
  const cache = keySetCache<string>();
  const [config, a, b, c] = keysOf(4) as [WeakKey, WeakKey, WeakKey, WeakKey];

  expect(cache.get(config, [a, b], () => "ab")).toBe("ab");
  expect(cache.get(config, [a, b, c], () => "abc")).toBe("abc");
  expect(cache.get(config, [a], () => "a")).toBe("a");
  expect(cache.get(config, [], () => "none")).toBe("none");
  expect(cache.get(config, [a, b], neverCreate)).toBe("ab");
});

test("the first key is part of the set", () => {
  const cache = keySetCache<string>();
  const [one, two, rule] = keysOf(3) as [WeakKey, WeakKey, WeakKey];

  expect(cache.get(one, [rule], () => "one")).toBe("one");
  expect(cache.get(two, [rule], () => "two")).toBe("two");
});

test("releasing an entry removes only that entry, including from a shared bucket", () => {
  const cache = keySetCache<string>();
  const first: WeakKey = {};
  const keys = keysOf(60);
  const releases = new Map<string, () => void>();
  const sets: [string, WeakKey[]][] = [];

  for (const [l, left] of keys.entries()) {
    for (const [offset, right] of keys.slice(l + 1).entries()) {
      const signature = `${String(l)}+${String(l + 1 + offset)}`;
      sets.push([signature, [left, right]]);
      cache.get(first, [left, right], (release) => {
        releases.set(signature, release);
        return signature;
      });
    }
  }

  // Release every other entry; releasing twice is harmless.
  sets.forEach(([signature], index) => {
    const release = releases.get(signature);
    if (index % 2 && release) {
      release();
      release();
    }
  });

  expect(cache.size().entries).toBe(Math.ceil(sets.length / 2));
  sets.forEach(([signature, set], index) => {
    if (index % 2) {
      expect(cache.get(first, set, () => `new ${signature}`)).toBe(
        `new ${signature}`,
      );
    } else {
      expect(cache.get(first, set, neverCreate)).toBe(signature);
    }
  });
});

test("a key outside WeakKey is refused rather than erased", () => {
  const cache = keySetCache<string>();
  const key: WeakKey = {};

  expect(() =>
    cache.get(key, [undefined as unknown as WeakKey], () => "x"),
  ).toThrow();
});
