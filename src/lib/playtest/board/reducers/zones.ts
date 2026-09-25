/**
 * Everything that moves cards between zones or reorders one: draw, mill, move
 * (one or many), reorder, peek, shuffle, random discard, and the London
 * mulligan flow.
 *
 * Conventions worth holding in your head:
 *
 *  - Index 0 of `zones.library` is the TOP. Insertion is `top` (0), `bottom`
 *    (the end) or an exact index, clamped. On the battlefield the END of the
 *    list is the FRONT (drawn last), so "bring to front" is an insert at the
 *    end.
 *  - A reducer that changes nothing returns the SAME state reference. The
 *    store relies on that to avoid recording an empty undo step (an empty
 *    draw, a mulligan outside the opening hand).
 *  - Leaving the battlefield wipes battlefield-only state (tapped, counters,
 *    offsets, rotation, group, position): a card that goes to the graveyard
 *    and comes back is not still tapped with two +1/+1 counters. Undo still
 *    restores it, because undo swaps whole states. Notes and commander tax
 *    are player annotations and survive every move.
 */

import type { InsertAt } from "../commands";
import { clampPos, defaultPos } from "../layout";
import { shuffleZone } from "../shuffle";
import { isPublicZone, ZONE_IDS, type GameCard, type GameState, type Pos, type ZoneId } from "../types";
import { addEvent, type Ctx } from "./log";
import { cardBucket, existingIds, own, pruneGroups, zoneIndex } from "./util";

export const OPENING_HAND_SIZE = 7;

type MoveOptions = {
  at: InsertAt;
  groupId?: string | null;
  pos?: Pos | null;
  faceDown?: boolean;
  tapped?: boolean;
};

function insert(list: string[], ids: string[], at: InsertAt): string[] {
  const index = at === "top" ? 0 : at === "bottom" ? list.length : Math.min(Math.max(Math.trunc(at), 0), list.length);
  return [...list.slice(0, index), ...ids, ...list.slice(index)];
}

function cleared(card: GameCard): GameCard {
  return {
    ...card,
    face: "front",
    tapped: false,
    rotation: 0,
    dimmed: false,
    revealed: false,
    counters: {},
    ptOffset: { power: 0, toughness: 0 },
    groupId: null,
    pos: null,
  };
}

/**
 * The single relocation primitive. Returns the new state and the zone of the
 * first moved card (for the event's `from`), or null when nothing moved.
 */
export function relocate(
  state: GameState,
  rawIds: readonly string[],
  to: ZoneId,
  options: MoveOptions,
): { state: GameState; from: ZoneId | null; mixed: boolean; moved: string[] } | null {
  const ids = existingIds(state, rawIds);
  if (ids.length === 0) return null;
  const origin = zoneIndex(state);
  const moving = new Set(ids);

  const zones = { ...state.zones };
  for (const zone of ZONE_IDS) {
    if (zones[zone].some((id) => moving.has(id))) zones[zone] = zones[zone].filter((id) => !moving.has(id));
  }
  zones[to] = insert(zones[to], ids, options.at);

  const cards = { ...state.cards };
  let working: GameState = { ...state, zones, cards };
  for (const id of ids) {
    const before = state.cards[id];
    const fromZone = origin.get(id) ?? null;
    let next: GameCard;
    if (fromZone === to && to === "battlefield") {
      // Reordering / repositioning within the table keeps its state.
      next = { ...before };
    } else if (to === "battlefield") {
      next = { ...cleared(before), tapped: options.tapped ?? false, face: options.faceDown ? "face-down" : "front" };
    } else if (fromZone === "battlefield" || !isPublicZone(to)) {
      next = { ...cleared(before), face: options.faceDown && isPublicZone(to) ? "face-down" : "front" };
    } else {
      next = { ...before, groupId: null, pos: null, face: options.faceDown ? "face-down" : "front" };
    }

    if (to === "battlefield") {
      const requestedGroup = options.groupId && own(working.groups, options.groupId) ? options.groupId : null;
      if (requestedGroup) {
        next = { ...next, groupId: requestedGroup, pos: null };
      } else if (options.pos) {
        next = { ...next, groupId: null, pos: clampPos(options.pos) };
      } else if (fromZone !== "battlefield") {
        working = { ...working, cards: { ...working.cards, [id]: next } };
        next = { ...next, groupId: null, pos: defaultPos(working) };
      }
    }
    cards[id] = next;
    working = { ...working, cards };
  }

  const firstFrom = origin.get(ids[0]) ?? null;
  const mixed = ids.some((id) => origin.get(id) !== firstFrom);
  return { state: pruneGroups(working), from: firstFrom, mixed, moved: ids };
}

function names(state: GameState, ids: string[]): string[] {
  return ids.map((id) => state.cards[id]?.name ?? "Unknown");
}

/** Metrics recorded at event time, because saved games keep states rather
 *  than commands (see metrics.ts): the mana value and card types of what just
 *  entered the battlefield. */
function battlefieldEntryData(state: GameState, ids: string[]): Record<string, number> {
  let mv = 0;
  let mvCreature = 0;
  let nCreature = 0;
  let nLand = 0;
  let nOther = 0;
  for (const id of ids) {
    const card = state.cards[id];
    if (!card) continue;
    const bucket = cardBucket(card);
    const value = card.manaValue ?? 0;
    mv += value;
    if (bucket === "creature") {
      nCreature++;
      mvCreature += value;
    } else if (bucket === "land") nLand++;
    else nOther++;
  }
  return { mv, mvCreature, nCreature, nLand, nOther };
}

export function moveMany(
  state: GameState,
  ctx: Ctx,
  ids: readonly string[],
  to: ZoneId,
  options: MoveOptions,
  kind: "move" | "draw" | "mill" = "move",
): GameState {
  const result = relocate(state, ids, to, options);
  if (!result) return state;
  const moved = result.state;
  const enteredBattlefield = result.moved.filter((id) => state.zones.battlefield.indexOf(id) === -1);
  const data: Record<string, string | number | boolean | null> = { count: result.moved.length };
  if (options.faceDown) data.faceDown = true;
  if (result.mixed) data.mixed = true;
  if (kind === "move" && to === "battlefield" && enteredBattlefield.length > 0) Object.assign(data, battlefieldEntryData(moved, enteredBattlefield));
  return addEvent(moved, ctx, {
    kind,
    ids: result.moved,
    names: names(moved, result.moved),
    from: result.from,
    to,
    data,
    // A draw or mill names the cards to their owner only.
    private: false,
  });
}

export function draw(state: GameState, ctx: Ctx, count: number): GameState {
  const n = Math.max(0, Math.min(Math.trunc(count) || 0, state.zones.library.length));
  if (n === 0) return state;
  return moveMany(state, ctx, state.zones.library.slice(0, n), "hand", { at: "bottom" }, "draw");
}

export function mill(state: GameState, ctx: Ctx, count: number): GameState {
  const n = Math.max(0, Math.min(Math.trunc(count) || 0, state.zones.library.length));
  if (n === 0) return state;
  // Milled cards are appended in the order they left the library, so the last
  // one milled is the newest (top) card of the graveyard.
  return moveMany(state, ctx, state.zones.library.slice(0, n), "graveyard", { at: "bottom" }, "mill");
}

export function randomDiscard(state: GameState, ctx: Ctx, cardId: string): GameState {
  if (!state.zones.hand.includes(cardId)) return state;
  const moved = relocate(state, [cardId], "graveyard", { at: "bottom" });
  if (!moved) return state;
  return addEvent(moved.state, ctx, {
    kind: "discard",
    ids: [cardId],
    names: names(moved.state, [cardId]),
    from: "hand",
    to: "graveyard",
  });
}

export function reorderZone(state: GameState, ctx: Ctx, zone: ZoneId, order: string[]): GameState {
  const current = state.zones[zone];
  if (order.length !== current.length) return state;
  const sameMembers = new Set(current);
  if (new Set(order).size !== order.length || !order.every((id) => sameMembers.has(id))) return state;
  if (order.every((id, i) => id === current[i])) return state;
  return addEvent(
    { ...state, zones: { ...state.zones, [zone]: [...order] } },
    ctx,
    { kind: "reorder", data: { zone }, private: !isPublicZone(zone) },
  );
}

export function peek(state: GameState, ctx: Ctx, zone: ZoneId, from: "top" | "bottom", count: number): GameState {
  const list = state.zones[zone];
  const n = Math.max(0, Math.min(Math.trunc(count) || 0, list.length));
  if (n === 0) return state;
  const seen = from === "top" ? list.slice(0, n) : list.slice(list.length - n);
  return addEvent(state, ctx, {
    kind: "peek",
    ids: seen,
    names: names(state, seen),
    from: zone,
    data: { zone, from, count: n },
    private: true,
  });
}

export function shuffle(state: GameState, ctx: Ctx, zone: ZoneId, seed: number): GameState {
  if (state.zones[zone].length < 2) return state;
  return addEvent(shuffleZone(state, zone, seed), ctx, { kind: "shuffle", data: { zone, seed } });
}

/** Paid mulligans owed at Keep: one bottom per mulligan, less a free one. */
export function bottomsRequired(state: GameState): number {
  const { mulligans } = state.opening;
  const free = state.config.freeMulligan === "first" && mulligans > 0 ? 1 : 0;
  return Math.max(0, Math.min(mulligans - free, state.zones.hand.length));
}

export function mulligan(state: GameState, ctx: Ctx, seed: number, free = false): GameState {
  if (state.opening.status !== "deciding") return state;
  const back = relocate(state, [...state.zones.hand], "library", { at: "bottom" });
  let next = back ? back.state : state;
  next = { ...shuffleZone(next, "library", seed), opening: { status: "deciding", mulligans: state.opening.mulligans + (free ? 0 : 1) } };
  const size = Math.min(OPENING_HAND_SIZE, next.zones.library.length);
  const dealt = relocate(next, next.zones.library.slice(0, size), "hand", { at: "bottom" });
  if (dealt) next = dealt.state;
  return addEvent(next, ctx, { kind: "mulligan", data: free ? { number: next.opening.mulligans, seed, free: true } : { number: next.opening.mulligans, seed } });
}

export function keep(state: GameState, ctx: Ctx, bottomIds: string[]): GameState {
  if (state.opening.status !== "deciding") return state;
  const required = bottomsRequired(state);
  const inHand = new Set(state.zones.hand);
  if (bottomIds.length !== required || new Set(bottomIds).size !== required || !bottomIds.every((id) => inHand.has(id))) return state;

  let next = state;
  if (required > 0) {
    // The first id listed is placed first, so the LAST one ends up on the very
    // bottom: "in the order I chose" reads top to bottom of what went under.
    const moved = relocate(state, bottomIds, "library", { at: "bottom" });
    if (moved) next = moved.state;
  }
  next = { ...next, opening: { ...next.opening, status: "kept" } };
  return addEvent(next, ctx, { kind: "keep", data: { bottom: required } });
}
