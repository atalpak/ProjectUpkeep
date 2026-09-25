/**
 * Turn, life, and the other player-level numbers, plus dice.
 *
 * `SET_TRACKER` takes ABSOLUTE values only. A "+1" button reads the current
 * value and sends `value + 1`, so a double-click or a stale render can never
 * apply the same delta twice, and direct entry ("set life to 27") is the same
 * command as a step. (`SET_LIFE` survives as a delta from the first version of
 * the board; it is sugar over the same clamp.)
 *
 * `NEXT_TURN` is ONE command that untaps, draws and empties the mana pool,
 * because the guide's "next turn = untap + draw" must be a single undo step
 * and a single log line. It also records a small board summary (power in
 * play, mana producers) on its event: saved games keep states, not commands,
 * so a chart of "power in play by turn" can only exist if that number was
 * written down at the time.
 */

import type { DiceKind } from "../commands";
import { LIMITS, MANA_KEYS, type GameState, type ManaKey, type Trackers } from "../types";
import { addEvent, type Ctx } from "./log";
import { relocate } from "./zones";
import { clampInt, cleanText, displayedPower, has, own, safeKey } from "./util";

const SIMPLE: Record<string, { label: string; min: number }> = {
  life: { label: "Life", min: -LIMITS.tracker },
  life2: { label: "Life 2", min: -LIMITS.tracker },
  poison: { label: "Poison", min: 0 },
  experience: { label: "Experience", min: 0 },
  energy: { label: "Energy", min: 0 },
  genericDamage: { label: "Damage", min: 0 },
};

const MANA_NAMES: Record<ManaKey, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };

export function setTracker(state: GameState, ctx: Ctx, path: string, rawValue: number): GameState {
  if (!Number.isFinite(rawValue)) return state;
  const t = state.trackers;

  if (has(SIMPLE, path)) {
    const spec = SIMPLE[path];
    const key = path as "life" | "life2" | "poison" | "experience" | "energy" | "genericDamage";
    const value = clampInt(rawValue, spec.min, LIMITS.tracker);
    if (value === t[key]) return state;
    const trackers: Trackers = { ...t, [key]: value };
    return addEvent({ ...state, trackers }, ctx, { kind: "tracker", data: { path, label: spec.label, old: t[key], value } });
  }

  if (path.startsWith("manaPool.")) {
    const key = path.slice("manaPool.".length) as ManaKey;
    if (!(MANA_KEYS as readonly string[]).includes(key)) return state;
    const value = clampInt(rawValue, 0, LIMITS.tracker);
    if (value === t.manaPool[key]) return state;
    const trackers: Trackers = { ...t, manaPool: { ...t.manaPool, [key]: value } };
    return addEvent({ ...state, trackers }, ctx, { kind: "tracker", data: { path, label: `${MANA_NAMES[key]} mana`, old: t.manaPool[key], value } });
  }

  if (path.startsWith("commanderDamage.")) {
    const label = cleanText(path.slice("commanderDamage.".length), LIMITS.groupLabel);
    if (!label || !safeKey(label)) return state;
    const old = own(t.commanderDamage, label) ?? 0;
    const value = clampInt(rawValue, 0, LIMITS.tracker);
    if (value === old) return state;
    if (old === 0 && Object.keys(t.commanderDamage).length >= 50) return state;
    const commanderDamage = { ...t.commanderDamage };
    if (value === 0) delete commanderDamage[label];
    else commanderDamage[label] = value;
    return addEvent({ ...state, trackers: { ...t, commanderDamage } }, ctx, {
      kind: "tracker",
      data: { path, label: `Commander damage from ${label}`, old, value },
    });
  }
  return state;
}

export function setLife(state: GameState, ctx: Ctx, delta: number): GameState {
  return setTracker(state, ctx, "life", state.trackers.life + Math.trunc(delta || 0));
}

export function setTurn(state: GameState, ctx: Ctx, turn: number): GameState {
  const value = clampInt(turn, 0, 9999);
  if (value === state.turn) return state;
  return addEvent({ ...state, turn: value }, ctx, { kind: "turn", data: { turn: value, drew: 0 } });
}

export function nextTurn(state: GameState, ctx: Ctx): GameState {
  if (state.opening.status !== "kept" || state.turn >= 9999) return state;
  const turn = state.turn + 1;

  const cards = { ...state.cards };
  let untapped = 0;
  for (const id of state.zones.battlefield) {
    if (cards[id]?.tapped) {
      cards[id] = { ...cards[id], tapped: false };
      untapped++;
    }
  }
  const trackers: Trackers = { ...state.trackers, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } };
  let next: GameState = { ...state, turn, cards, trackers };

  // The first turn only draws when the player chose to be on the draw. The
  // draw is folded into this command's own event (no separate draw line), so
  // "Turn 3, drew 1 card" is one entry and one gesture.
  const wantsDraw = !(turn === 1 && !state.config.firstTurnDraws);
  const drawnIds = wantsDraw ? next.zones.library.slice(0, 1) : [];
  if (drawnIds.length > 0) {
    const moved = relocate(next, drawnIds, "hand", { at: "bottom" });
    if (moved) next = moved.state;
  }

  let power = 0;
  let producers = 0;
  for (const id of next.zones.battlefield) {
    const card = next.cards[id];
    if (!card) continue;
    power += displayedPower(card);
    if (card.producesMana) producers++;
  }
  return addEvent(next, ctx, {
    kind: "turn",
    ids: drawnIds,
    names: drawnIds.map((id) => next.cards[id]?.name ?? "Unknown"),
    data: { turn, drew: drawnIds.length, untapped, power, producers },
  });
}

const DICE_SIDES: Record<DiceKind, number> = { coin: 1, d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

export function roll(state: GameState, ctx: Ctx, kind: DiceKind, result: number): GameState {
  const sides = DICE_SIDES[kind];
  if (sides === undefined || !Number.isInteger(result)) return state;
  // A coin is 0 (tails) or 1 (heads); a die is 1..sides.
  if (kind === "coin" ? result !== 0 && result !== 1 : result < 1 || result > sides) return state;
  return addEvent(state, ctx, { kind: "roll", data: { kind, result } });
}
