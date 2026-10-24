/**
 * Seeded RNG (mulberry32). The engine must never call Math.random():
 * any randomness goes through here so every demo run is identical.
 */

export const DEFAULT_SEED = 0x1f1e5;

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Current internal state, so it can be stored and resumed. */
  readonly seed: number;
}

/** Pure step: returns the value and the next seed. Useful inside reducers. */
export function nextRandom(seed: number): [value: number, nextSeed: number] {
  const nextSeed = (seed + 0x6d2b79f5) | 0;
  let t = nextSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, nextSeed];
}

export function createRng(seed: number = DEFAULT_SEED): Rng {
  let state = seed | 0;
  const next = (): number => {
    const [value, nextSeed] = nextRandom(state);
    state = nextSeed;
    return value;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error('pick() on empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    get seed() {
      return state;
    },
  };
}
