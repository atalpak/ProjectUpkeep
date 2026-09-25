/**
 * The opponent-interaction prompt generator: a PURE function of
 * (settings, simulator seed, turn, reroll index). It is never given the game
 * state, so it cannot target or move a card, and it has no clock and no
 * `Math.random`, so the same inputs always give the same prompt.
 *
 * That determinism is what makes undo, redo and reload well-behaved: a prompt
 * is regenerated from its inputs and recorded (`RECORD_INTERACTION`), so
 * pressing undo and redo shows the same prompt, and reloading a saved game
 * never re-rolls one. A reroll is a new `rerollIndex`, recorded with its
 * reason, never a silent re-draw. Deliberately not named `simulate*`:
 * `src/lib/playtest/simulate.ts` is the consistency analyzer, a different
 * feature.
 *
 * Shape of a turn: up to `maxPerTurn` picks, each drawn from the weighted list
 * of enabled categories plus a "nothing happens" entry (weight from
 * `settings.nothing`). Picking "nothing" ends the turn's prompts early, and a
 * category is used at most once a turn, so "no interaction" is always a real
 * outcome. `gameChangers` doubles the weight of counterspells, spot removal
 * and mass removal: Project Upkeep's own meaning for that toggle. Before
 * `firstTurn` nothing is generated at all.
 */

import { mulberry32, type RNG } from "../rng";
import type { InteractionCategory, SimulatorSettings } from "../board/types";
import { INTERACTION_CATEGORIES } from "../board/types";
import { LEVEL_WEIGHT } from "./presets";

export type GeneratedTurn = {
  prompts: InteractionCategory[];
  /** Cards an opponent mills from the player this turn (0 unless mill mode). */
  mill: number;
};

/** Mixes the inputs into one 32-bit seed. Multiplying by large odd constants
 *  spreads adjacent turns and rerolls apart before mulberry32 sees them. */
export function mixSeed(seed: number, turn: number, rerollIndex: number): number {
  let h = (seed ^ Math.imul(turn + 1, 0x9e3779b1) ^ Math.imul(rerollIndex + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const BOOSTED: readonly InteractionCategory[] = ["counterspell", "spotRemoval", "massRemoval"];

function pick(entries: Array<{ key: InteractionCategory | null; weight: number }>, rng: RNG): InteractionCategory | null {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.key;
  }
  return entries[entries.length - 1].key;
}

export function generateInteraction(settings: SimulatorSettings, seed: number, turn: number, rerollIndex: number): GeneratedTurn {
  if (!settings.enabled || turn < settings.firstTurn) return { prompts: [], mill: 0 };
  const rng = mulberry32(mixSeed(seed, turn, rerollIndex));

  const mill = settings.millOpponent ? Math.floor(rng() * 4) : 0;
  const remaining = new Set<InteractionCategory>(INTERACTION_CATEGORIES.filter((c) => settings.chances[c] !== "off"));
  const prompts: InteractionCategory[] = [];

  for (let i = 0; i < settings.maxPerTurn; i++) {
    const entries: Array<{ key: InteractionCategory | null; weight: number }> = [];
    for (const category of INTERACTION_CATEGORIES) {
      if (!remaining.has(category)) continue;
      const boost = settings.gameChangers && BOOSTED.includes(category) ? 2 : 1;
      entries.push({ key: category, weight: LEVEL_WEIGHT[settings.chances[category]] * boost });
    }
    // "Nothing" only matters while it is possible to stop early.
    entries.push({ key: null, weight: LEVEL_WEIGHT[settings.nothing] });
    const chosen = pick(entries, rng);
    if (chosen === null) break;
    prompts.push(chosen);
    remaining.delete(chosen);
  }
  return { prompts, mill };
}
