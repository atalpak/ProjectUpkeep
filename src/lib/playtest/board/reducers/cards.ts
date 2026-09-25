/**
 * Per-card state: tap, face, rotation, dim, P/T offsets, commander tax, notes,
 * reveals and counters. Every one of these is a manual annotation, not a rule:
 * nothing here knows what a counter does or when a card should untap.
 *
 * `SET_CARD_FLAGS` is the one general setter and the single-field commands
 * (`SET_TAPPED`, `SET_FACE`, `SET_ROTATION`) are thin wrappers over it, so a
 * tap and a rotate can never disagree about how a change is recorded. Each
 * flag that actually changed is logged once per gesture, naming only the cards
 * it changed, so "untap all" is one line, not one per land.
 */

import type { CardFlags } from "../commands";
import { LIMITS, type GameCard, type GameState, type Rotation } from "../types";
import { addEvent, type Ctx } from "./log";
import { clampInt, cleanText, existingIds, own, safeKey, zoneIndex } from "./util";

const ROTATIONS: readonly number[] = [0, 90, 180, 270];

function sameOffset(a: GameCard["ptOffset"], b: GameCard["ptOffset"]): boolean {
  return a.power === b.power && a.toughness === b.toughness;
}

function hiddenFace(cards: GameCard[]): boolean {
  return cards.some((c) => c.face === "face-down");
}

export function setCardFlags(state: GameState, ctx: Ctx, rawIds: readonly string[], flags: CardFlags): GameState {
  const ids = existingIds(state, rawIds);
  if (ids.length === 0) return state;
  const origin = zoneIndex(state);

  let next = state;
  const cards = { ...state.cards };
  const changed: Record<string, string[]> = {};
  const note = (flag: string, id: string) => {
    (changed[flag] ??= []).push(id);
  };

  for (const id of ids) {
    const before = cards[id];
    let card = before;
    if (flags.tapped !== undefined && flags.tapped !== card.tapped) {
      card = { ...card, tapped: flags.tapped };
      note("tapped", id);
    }
    if (flags.face !== undefined && flags.face !== card.face) {
      card = { ...card, face: flags.face };
      note("face", id);
    }
    if (flags.rotation !== undefined && ROTATIONS.includes(flags.rotation) && flags.rotation !== card.rotation) {
      card = { ...card, rotation: flags.rotation };
      note("rotation", id);
    }
    if (flags.dimmed !== undefined && flags.dimmed !== card.dimmed) {
      card = { ...card, dimmed: flags.dimmed };
      note("dimmed", id);
    }
    if (flags.ptOffset !== undefined) {
      const ptOffset = { power: clampInt(flags.ptOffset.power, -99, 99), toughness: clampInt(flags.ptOffset.toughness, -99, 99) };
      if (!sameOffset(ptOffset, card.ptOffset)) {
        card = { ...card, ptOffset };
        note("ptOffset", id);
      }
    }
    if (flags.commanderTax !== undefined) {
      const commanderTax = clampInt(flags.commanderTax, 0, 99);
      if (commanderTax !== card.commanderTax) {
        card = { ...card, commanderTax };
        note("commanderTax", id);
      }
    }
    if (card !== before) cards[id] = card;
  }

  const flagNames = Object.keys(changed);
  if (flagNames.length === 0) return state;
  next = { ...state, cards };
  for (const flag of flagNames) {
    const touched = changed[flag];
    const sample = cards[touched[0]];
    const value =
      flag === "ptOffset"
        ? `${sample.ptOffset.power >= 0 ? "+" : ""}${sample.ptOffset.power}/${sample.ptOffset.toughness >= 0 ? "+" : ""}${sample.ptOffset.toughness}`
        : (sample[flag as keyof GameCard] as string | number | boolean);
    next = addEvent(next, ctx, {
      kind: "flags",
      ids: touched,
      names: touched.map((id) => state.cards[id].name),
      from: origin.get(touched[0]) ?? null,
      data: { flag, value, hidden: hiddenFace(touched.map((id) => state.cards[id])) },
    });
  }
  return next;
}

export function setTapped(state: GameState, ctx: Ctx, cardId: string, tapped: boolean): GameState {
  return setCardFlags(state, ctx, [cardId], { tapped });
}

export function setRotation(state: GameState, ctx: Ctx, cardId: string, rotation: Rotation): GameState {
  return setCardFlags(state, ctx, [cardId], { rotation });
}

export function setNote(state: GameState, ctx: Ctx, cardId: string, note: string | null): GameState {
  const card = own(state.cards, cardId);
  if (!card) return state;
  const cleaned = cleanText(note, LIMITS.note);
  if (cleaned === card.note) return state;
  const next = { ...state, cards: { ...state.cards, [cardId]: { ...card, note: cleaned } } };
  // Private: a note is the owner's own scrap of paper, never shared.
  return addEvent(next, ctx, { kind: "note", ids: [cardId], names: [card.name], private: true });
}

export function reveal(state: GameState, ctx: Ctx, rawIds: readonly string[], revealed: boolean): GameState {
  const ids = existingIds(state, rawIds).filter((id) => state.cards[id].revealed !== revealed);
  if (ids.length === 0) return state;
  const cards = { ...state.cards };
  for (const id of ids) cards[id] = { ...cards[id], revealed };
  // A reveal is private in the log for the same reason a share never shows a
  // hand card: what was revealed lives in the owner's record only.
  return addEvent({ ...state, cards }, ctx, {
    kind: "reveal",
    ids,
    names: ids.map((id) => state.cards[id].name),
    data: { revealed },
    private: true,
  });
}

export function addCounter(state: GameState, ctx: Ctx, cardId: string, rawName: string, delta: number): GameState {
  const card = own(state.cards, cardId);
  const name = cleanText(rawName, LIMITS.counterName);
  if (!card || !name || !safeKey(name) || !Number.isFinite(delta) || Math.trunc(delta) === 0) return state;
  const before = own(card.counters, name) ?? 0;
  // Counters are counts of a thing on a card, so they floor at zero and a
  // zero count is no counter at all (no "0 charge" chip on the board).
  const total = clampInt(before + Math.trunc(delta), 0, LIMITS.counterValue);
  if (total === before) return state;
  const counters = { ...card.counters };
  if (total === 0) delete counters[name];
  else counters[name] = total;
  const next = { ...state, cards: { ...state.cards, [cardId]: { ...card, counters } } };
  return addEvent(next, ctx, {
    kind: "counter",
    ids: [cardId],
    names: [card.name],
    from: zoneIndex(state).get(cardId) ?? null,
    data: { counter: name, delta: total - before, total, hidden: card.face === "face-down" },
  });
}

/** +1 to every counter type a card ALREADY has. It never invents a new type. */
export function proliferate(state: GameState, ctx: Ctx, rawIds: readonly string[]): GameState {
  const ids = existingIds(state, rawIds).filter((id) => Object.keys(state.cards[id].counters).length > 0);
  if (ids.length === 0) return state;
  const cards = { ...state.cards };
  for (const id of ids) {
    const counters: Record<string, number> = {};
    for (const [name, value] of Object.entries(cards[id].counters)) counters[name] = clampInt(value + 1, 0, LIMITS.counterValue);
    cards[id] = { ...cards[id], counters };
  }
  return addEvent({ ...state, cards }, ctx, {
    kind: "proliferate",
    ids,
    names: ids.map((id) => state.cards[id].name),
    from: "battlefield",
    data: { count: ids.length },
  });
}
