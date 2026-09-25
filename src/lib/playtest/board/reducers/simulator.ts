/**
 * Recording opponent-interaction prompts. The prompts themselves are generated
 * OUTSIDE the core (opponent/generate.ts, a pure function of seed + settings +
 * turn + reroll) and carried in on `RECORD_INTERACTION`, the same way a
 * shuffle carries its seed. That is what makes undo, redo and reload all
 * reproduce the same prompt: nothing here ever rolls a die.
 *
 * Simulator state lives beside the game objects, never inside them, and no
 * command here moves or targets a card.
 */

import { INTERACTION_CATEGORIES, type ChanceLevel, type GameState, type InteractionCategory, type InteractionResolution, type SimulatorSettings } from "../types";
import { addEvent, type Ctx } from "./log";
import { clampInt, cleanText } from "./util";

const LEVELS: readonly ChanceLevel[] = ["off", "low", "medium", "high"];
const RESOLUTIONS: readonly InteractionResolution[] = ["pending", "ignored", "resolved", "rerolled"];
const MAX_RESULTS = 300;

export function sanitizeSettings(input: SimulatorSettings): SimulatorSettings {
  const level = (value: ChanceLevel): ChanceLevel => (LEVELS.includes(value) ? value : "off");
  const chances = {} as SimulatorSettings["chances"];
  for (const category of INTERACTION_CATEGORIES) chances[category] = level(input.chances?.[category]);
  return {
    enabled: input.enabled === true,
    firstTurn: clampInt(input.firstTurn, 1, 99),
    maxPerTurn: clampInt(input.maxPerTurn, 1, 3),
    chances,
    nothing: level(input.nothing),
    millOpponent: input.millOpponent === true,
    gameChangers: input.gameChangers === true,
    preset: cleanText(input.preset, 40) ?? "custom",
  };
}

export function setSimulator(state: GameState, ctx: Ctx, settings: SimulatorSettings): GameState {
  const clean = sanitizeSettings(settings);
  if (JSON.stringify(clean) === JSON.stringify(state.simulator.settings)) return state;
  return addEvent({ ...state, simulator: { ...state.simulator, settings: clean } }, ctx, { kind: "simulator", private: true });
}

export function recordInteraction(
  state: GameState,
  ctx: Ctx,
  input: { turn: number; rerollIndex: number; prompts: InteractionCategory[]; resolution: InteractionResolution; reason?: string | null },
): GameState {
  if (!RESOLUTIONS.includes(input.resolution)) return state;
  const turn = clampInt(input.turn, 0, 9999);
  const rerollIndex = clampInt(input.rerollIndex, 0, 99);
  const prompts = input.prompts.filter((p) => (INTERACTION_CATEGORIES as readonly string[]).includes(p)).slice(0, 3);
  const reason = cleanText(input.reason ?? null, 200);

  const results = [...state.simulator.results];
  const at = results.findIndex((r) => r.turn === turn && r.rerollIndex === rerollIndex);
  const entry = { turn, rerollIndex, prompts, resolution: input.resolution, reason };
  if (at === -1) results.push(entry);
  else results[at] = { ...results[at], resolution: input.resolution, reason };
  const capped = results.length > MAX_RESULTS ? results.slice(results.length - MAX_RESULTS) : results;

  return addEvent({ ...state, simulator: { ...state.simulator, results: capped } }, ctx, {
    kind: "interaction",
    data: { turn, rerollIndex, resolution: input.resolution },
    private: true,
  });
}
