/**
 * Dice and coin results. The REDUCER never rolls (lint bans randomness in
 * `board/`); the browser rolls here, then sends the recorded result on a
 * `ROLL` command, so a saved log shows what actually happened rather than
 * only what a seed would have produced.
 */

import type { RNG } from "./rng";
import type { DiceKind } from "./board/commands";

export const DICE_KINDS: readonly DiceKind[] = ["coin", "d4", "d6", "d8", "d10", "d12", "d20"];

const SIDES: Record<DiceKind, number> = { coin: 2, d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

/** A coin is 0 (tails) or 1 (heads); a die is 1..sides. */
export function rollResult(kind: DiceKind, rng: RNG): number {
  const sides = SIDES[kind];
  const n = Math.min(sides - 1, Math.floor(rng() * sides));
  return kind === "coin" ? n : n + 1;
}

export function diceLabel(kind: DiceKind, result: number): string {
  return kind === "coin" ? (result === 1 ? "Heads" : "Tails") : `${kind}: ${result}`;
}
