/**
 * Objects that did not come from the decklist: tokens, custom cards, searched
 * catalog cards and real copies. Creating one never touches the deck source or
 * the library; each gets its own id, carried on the command (the reducer has
 * no way to mint one), so undo and replay reproduce it exactly.
 */

import type { ExtraSpec } from "../commands";
import { clampPos, defaultPos } from "../layout";
import { LIMITS, type GameCard, type GameState, type Pos, type ZoneId } from "../types";
import { addEvent, type Ctx } from "./log";
import { cleanImageUrl, cleanText, has, own, pruneGroups, safeKey, zoneOf } from "./util";

function buildCard(id: string, spec: ExtraSpec, kind: GameCard["kind"], copiedFromId: string | null): GameCard {
  return {
    id,
    kind,
    cardId: spec.cardId ?? null,
    oracleId: spec.oracleId ?? null,
    name: cleanText(spec.name, LIMITS.name) ?? "Unnamed",
    typeLine: cleanText(spec.typeLine ?? null, LIMITS.name),
    manaValue: typeof spec.manaValue === "number" && Number.isFinite(spec.manaValue) ? Math.max(0, Math.min(99, Math.trunc(spec.manaValue))) : null,
    producesMana: spec.producesMana ?? false,
    imageSmall: cleanImageUrl(spec.imageSmall),
    imageNormal: cleanImageUrl(spec.imageNormal),
    imageBack: cleanImageUrl(spec.imageBack ?? null),
    face: "front",
    tapped: false,
    rotation: 0,
    dimmed: false,
    revealed: false,
    counters: {},
    note: cleanText(spec.note ?? null, LIMITS.note),
    copiedFromId,
    groupId: null,
    power: cleanText(spec.power, 8),
    toughness: cleanText(spec.toughness, 8),
    ptOffset: { power: 0, toughness: 0 },
    commanderTax: 0,
    pos: null,
  };
}

export function createExtra(
  state: GameState,
  ctx: Ctx,
  input: { ids: string[]; spec: ExtraSpec; kind: "token" | "extra" | "copy"; copiedFromId?: string | null; zone: ZoneId; pos?: Pos | null },
): GameState {
  const copiedFromId = input.kind === "copy" ? (input.copiedFromId ?? null) : null;
  if (input.kind === "copy" && copiedFromId === null) return state;
  const fresh = [...new Set(input.ids)].filter((id) => id.length > 0 && id.length <= 100 && safeKey(id) && !has(state.cards, id));
  const room = Math.max(0, LIMITS.cards - Object.keys(state.cards).length);
  const ids = fresh.slice(0, room);
  if (ids.length === 0) return state;

  let working: GameState = state;
  for (const id of ids) {
    let card = buildCard(id, input.spec, input.kind, copiedFromId);
    working = { ...working, cards: { ...working.cards, [id]: card }, zones: { ...working.zones, [input.zone]: [...working.zones[input.zone], id] } };
    if (input.zone === "battlefield") {
      card = { ...card, pos: input.pos ? clampPos(input.pos) : defaultPos(working) };
      working = { ...working, cards: { ...working.cards, [id]: card } };
    }
  }
  return addEvent(working, ctx, {
    kind: "create",
    ids,
    names: [working.cards[ids[0]].name],
    to: input.zone,
    data: { count: ids.length, kind: input.kind },
  });
}

export function deleteObject(state: GameState, ctx: Ctx, cardId: string): GameState {
  const card = own(state.cards, cardId);
  if (!card) return state;
  const from = zoneOf(state, cardId);
  const zones = { ...state.zones };
  if (from) zones[from] = zones[from].filter((id) => id !== cardId);
  const cards = { ...state.cards };
  delete cards[cardId];
  const config = state.config.commanderIds.includes(cardId)
    ? { ...state.config, commanderIds: state.config.commanderIds.filter((id) => id !== cardId) }
    : state.config;
  return addEvent(pruneGroups({ ...state, zones, cards, config }), ctx, {
    kind: "delete",
    ids: [cardId],
    names: [card.name],
    from,
    data: { hidden: card.face === "face-down" },
  });
}
