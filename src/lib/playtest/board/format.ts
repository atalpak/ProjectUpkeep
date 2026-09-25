/**
 * Game formats. Two, by owner decision: Commander (40 life, commanders start
 * in the command zone) and 20-life constructed. Anything else (Brawl, Oathbreaker,
 * Attractions, Planechase) is a later addition; the zone list in types.ts is
 * extensible and this is the one place a format's defaults live.
 *
 * Nothing here is inferred silently from deck size: the start dialog shows the
 * format, the mulligan policy and the first-turn draw, and the player can
 * change each. Free mulligans in particular default OFF, because assuming
 * "Commander means free mulligan" is a table rule some groups do not play.
 */

import type { GameConfig, GameFormat } from "./types";

export const FORMAT_LABELS: Record<GameFormat, string> = {
  commander: "Commander",
  constructed: "Constructed (20 life)",
};

export function defaultConfig(format: GameFormat): GameConfig {
  return {
    format,
    startingLife: format === "commander" ? 40 : 20,
    freeMulligan: "none",
    firstTurnDraws: false,
    commanderIds: [],
  };
}

/** The format a deck most likely wants, offered as the dialog's default: a
 *  configured commander means Commander. A suggestion, never a rule. */
export function suggestFormat(commanderCount: number): GameFormat {
  return commanderCount > 0 ? "commander" : "constructed";
}

export function sanitizeLife(value: number, format: GameFormat): number {
  if (!Number.isFinite(value)) return defaultConfig(format).startingLife;
  return Math.min(Math.max(Math.trunc(value), 1), 999);
}
