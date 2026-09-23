/**
 * Deterministic seeded shuffle for a board zone — a thin wrapper around the
 * shared primitives in `src/lib/playtest/rng.ts` so `reduce.ts` doesn't reach
 * outside `board/` for basic array math. Sharing that module directly (rather
 * than copying Mulberry32 into a separate package) is the whole reason this
 * folder lives under `src/lib/playtest/` — see `types.ts`'s header.
 */

import { mulberry32, shuffle as fisherYatesShuffle } from "../rng";
import type { GameState, ZoneId } from "./types";

/** Returns a new `GameState` with `zone` reordered by the given seed. Does
 *  not touch anything else — the caller is responsible for logging. */
export function shuffleZone(state: GameState, zone: ZoneId, seed: number): GameState {
  const order = fisherYatesShuffle([...state.zones[zone]], mulberry32(seed));
  return { ...state, zones: { ...state.zones, [zone]: order } };
}
