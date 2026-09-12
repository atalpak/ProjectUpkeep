/**
 * A seeded PRNG and the shuffle built on it.
 *
 * The simulator has to run the same "random" hand twice: once to produce the
 * headline numbers, and again when the UI wants to re-show one specific
 * interesting hand it already summarised (a screwed opener, say) without
 * having to have kept ten thousand hands in memory to do it. Both of those
 * need the same seed to produce the same sequence of hands, which
 * `Math.random()` cannot promise. Mulberry32 is not cryptographic — it does
 * not need to be, nothing here is adversarial — it is small, fast, and has no
 * dependency to add.
 */

export type RNG = () => number;

/** Mulberry32: a 32-bit state, four mixing steps, one float in [0, 1) out. */
export function mulberry32(seed: number): RNG {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates, in place. Mutates `array` and returns it — the simulator
 * reshuffles the same backing array on every iteration rather than rebuilding
 * the library from scratch per hand, and returning it too just saves the
 * caller a line.
 */
export function shuffle<T>(array: T[], rng: RNG): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}
