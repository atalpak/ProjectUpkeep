/**
 * Named archetypes for the opponent-interaction PROMPT generator, and the
 * words shown for each prompt.
 *
 * Two things this is not. It is not an opponent: nothing here plays cards,
 * targets anything or resolves anything, it only suggests "the table might do
 * X this turn" and the player decides what that means. And the odds are not
 * Archidekt's (those are not public): they are Project Upkeep's own, chosen to
 * be legible, and the UI labels them that way. A "level" maps to a weight
 * (`LEVEL_WEIGHT`), and a turn's prompt is drawn from those weights.
 */

import {
  defaultSimulatorSettings,
  type ChanceLevel,
  type InteractionCategory,
  type SimulatorSettings,
} from "../board/types";

export const LEVEL_WEIGHT: Record<ChanceLevel, number> = { off: 0, low: 1, medium: 3, high: 6 };

export const CATEGORY_LABELS: Record<InteractionCategory, string> = {
  counterspell: "Counterspells",
  spotRemoval: "Spot removal",
  massRemoval: "Mass removal",
  attack: "Attacks",
  stax: "Stax pieces",
  discard: "Discard",
};

/** What a prompt says. Deliberately vague about targets: the player picks. */
export const PROMPT_TEXT: Record<InteractionCategory, string> = {
  counterspell: "An opponent may counter the next spell you cast this turn.",
  spotRemoval: "An opponent removes one of your permanents. You choose which is fair.",
  massRemoval: "An opponent sweeps the board. Resolve it however your table would.",
  attack: "An opponent attacks you this turn. Decide the damage and any blocks yourself.",
  stax: "An opponent lands a tax or lock piece. Note it and play around it.",
  discard: "An opponent makes you discard a card. Choose one from your hand.",
};

export type Preset = { id: string; label: string; description: string; settings: Omit<SimulatorSettings, "enabled" | "firstTurn" | "maxPerTurn" | "millOpponent" | "gameChangers" | "preset"> };

const level = (
  counterspell: ChanceLevel,
  spotRemoval: ChanceLevel,
  massRemoval: ChanceLevel,
  attack: ChanceLevel,
  stax: ChanceLevel,
  discard: ChanceLevel,
  nothing: ChanceLevel,
): Preset["settings"] => ({ chances: { counterspell, spotRemoval, massRemoval, attack, stax, discard }, nothing });

export const PRESETS: Preset[] = [
  { id: "balanced", label: "Balanced pod", description: "A mix of everything, with quiet turns.", settings: level("low", "medium", "low", "medium", "low", "low", "medium") },
  { id: "casual", label: "Casual kitchen table", description: "Mostly attacks; little interaction.", settings: level("off", "low", "off", "medium", "off", "low", "high") },
  { id: "competitive", label: "Competitive", description: "Counters and removal are frequent; few idle turns.", settings: level("high", "high", "medium", "medium", "low", "medium", "low") },
  { id: "aggro", label: "Aggro table", description: "Attacks nearly every turn.", settings: level("off", "low", "off", "high", "off", "off", "low") },
  { id: "control", label: "Control table", description: "Counterspells and sweepers.", settings: level("high", "medium", "high", "low", "low", "medium", "medium") },
  { id: "stax", label: "Stax table", description: "Taxes, locks and discard.", settings: level("medium", "low", "low", "low", "high", "high", "medium") },
];

export function applyPreset(current: SimulatorSettings, presetId: string): SimulatorSettings {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return current;
  return { ...current, ...preset.settings, chances: { ...preset.settings.chances }, preset: preset.id };
}

export function defaultSettingsFor(presetId: string): SimulatorSettings {
  return applyPreset(defaultSimulatorSettings(), presetId);
}
