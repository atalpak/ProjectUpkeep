/**
 * Placement and grouping on the free-placement table.
 *
 * A drag ends in ONE `SET_LAYOUT`, however many cards moved and however far,
 * which is the whole reason a drag is a single undo step. `SET_GROUP` turns a
 * selection into a named, arranged group (row, column or stack) or dissolves
 * one; the group's members are never positioned individually (layout.ts
 * derives them from the anchor), so moving a group is `SET_GROUP` with just a
 * new anchor and no ids.
 */

import type { GroupArrangement } from "../types";
import type { Placement } from "../commands";
import { clampPos, defaultPos, resolvedPositions } from "../layout";
import { LIMITS, type GameState, type Pos } from "../types";
import { addEvent, type Ctx } from "./log";
import { cleanText, existingIds, own, pruneGroups, safeKey } from "./util";

const ARRANGEMENTS: readonly GroupArrangement[] = ["row", "column", "stack"];

export function setLayout(state: GameState, ctx: Ctx, placements: readonly Placement[], order?: string[]): GameState {
  const cards = { ...state.cards };
  let touched = 0;
  const seen = new Set<string>();
  for (const placement of placements) {
    const card = own(cards, placement.id);
    if (!card || seen.has(placement.id) || !state.zones.battlefield.includes(placement.id)) continue;
    seen.add(placement.id);
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y)) continue;
    const pos = clampPos({ x: placement.x, y: placement.y });
    // Placing a card yourself takes it out of any group: the group's derived
    // position would otherwise fight the one just chosen.
    if (card.groupId === null && card.pos && card.pos.x === pos.x && card.pos.y === pos.y) continue;
    cards[placement.id] = { ...card, pos, groupId: null };
    touched++;
  }

  let zones = state.zones;
  if (order) {
    const current = state.zones.battlefield;
    const members = new Set(current);
    const exact = order.length === current.length && new Set(order).size === order.length && order.every((id) => members.has(id));
    if (exact && order.some((id, i) => id !== current[i])) {
      zones = { ...state.zones, battlefield: [...order] };
      touched++;
    }
  }
  if (touched === 0) return state;
  return addEvent(pruneGroups({ ...state, cards, zones }), ctx, {
    kind: "layout",
    ids: [...seen],
    data: { count: seen.size },
    private: false,
  });
}

export function setGroup(
  state: GameState,
  ctx: Ctx,
  rawIds: readonly string[],
  groupId: string | null,
  spec?: { label?: string; arrangement?: GroupArrangement; anchor?: Pos },
): GameState {
  const ids = existingIds(state, rawIds).filter((id) => state.zones.battlefield.includes(id));

  if (groupId === null) {
    if (ids.length === 0) return state;
    const positions = resolvedPositions(state);
    const cards = { ...state.cards };
    let changed = 0;
    for (const id of ids) {
      const card = cards[id];
      if (!card.groupId) continue;
      cards[id] = { ...card, groupId: null, pos: positions.get(id) ?? defaultPos(state) };
      changed++;
    }
    if (changed === 0) return state;
    return addEvent(pruneGroups({ ...state, cards }), ctx, { kind: "group", ids, data: { label: null, count: changed } });
  }

  if (!/^[A-Za-z0-9_-]{1,40}$/.test(groupId) || !safeKey(groupId)) return state;
  const existing = own(state.groups, groupId);
  if (!existing && ids.length === 0) return state;

  const positions = resolvedPositions(state);
  const anchorGuess = ids.length > 0 ? (positions.get(ids[0]) ?? defaultPos(state)) : { x: 0.1, y: 0.1 };
  const group = {
    label: cleanText(spec?.label, LIMITS.groupLabel) ?? existing?.label ?? "Group",
    arrangement: spec?.arrangement && ARRANGEMENTS.includes(spec.arrangement) ? spec.arrangement : (existing?.arrangement ?? "row"),
    anchor: spec?.anchor ? clampPos(spec.anchor) : (existing?.anchor ?? clampPos(anchorGuess)),
  };

  const cards = { ...state.cards };
  for (const id of ids) cards[id] = { ...cards[id], groupId, pos: null };
  const groups = { ...state.groups, [groupId]: group };
  return addEvent(pruneGroups({ ...state, cards, groups }), ctx, {
    kind: "group",
    ids,
    data: { label: group.label, count: ids.length },
  });
}
