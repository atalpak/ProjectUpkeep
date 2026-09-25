/**
 * The invariants a `GameState` must satisfy at every moment, checked in two
 * places: on load (serialize.ts refuses a snapshot that breaks one) and after
 * EVERY command in the property test (scripts/playtest-board-property.test.ts).
 * Having one list serve both is the point: a reducer bug and a corrupt save
 * are the same failure, and this is how either is caught.
 *
 * Returns human-readable violations rather than throwing so a test can show
 * all of them at once; an empty array means the state is sound.
 */

import { has } from "./reducers/util";
import { LIMITS, MANA_KEYS, ZONE_IDS, type GameState, type Pos } from "./types";

const MAX_TURN = 9999;

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function inUnit(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function validPos(pos: Pos | null): boolean {
  return pos === null || (inUnit(pos.x) && inUnit(pos.y));
}

export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const add = (message: string) => {
    if (problems.length < 50) problems.push(message);
  };

  // Every card in exactly one zone, exactly once; no zone names a missing card.
  const seen = new Map<string, string>();
  for (const zone of ZONE_IDS) {
    for (const id of state.zones[zone] ?? []) {
      if (!has(state.cards, id)) add(`zone ${zone} references missing card ${id}`);
      const before = seen.get(id);
      if (before !== undefined) add(`card ${id} appears in ${before} and ${zone}`);
      seen.set(id, zone);
    }
  }
  const ids = Object.keys(state.cards);
  if (ids.length > LIMITS.cards) add(`more than ${LIMITS.cards} cards`);
  for (const id of ids) {
    if (!seen.has(id)) add(`card ${id} is in no zone`);
    const card = state.cards[id];
    if (card.id !== id) add(`card ${id} has mismatched id ${card.id}`);
    if (card.name.length === 0 || card.name.length > LIMITS.name) add(`card ${id} has a bad name length`);
    if (card.note !== null && card.note.length > LIMITS.note) add(`card ${id} note too long`);
    for (const url of [card.imageSmall, card.imageNormal, card.imageBack]) {
      if (url !== null && url.length > LIMITS.imageUrl) add(`card ${id} has an oversize image URL`);
    }
    for (const [name, value] of Object.entries(card.counters)) {
      if (name.length === 0 || name.length > LIMITS.counterName) add(`card ${id} has a bad counter name`);
      if (!isInt(value) || value < 1 || value > LIMITS.counterValue) add(`card ${id} counter ${name} is not an integer from 1 to ${LIMITS.counterValue}`);
    }
    if (!isInt(card.ptOffset.power) || !isInt(card.ptOffset.toughness)) add(`card ${id} ptOffset is not integers`);
    if (!isInt(card.commanderTax) || card.commanderTax < 0 || card.commanderTax > LIMITS.tracker) add(`card ${id} commanderTax out of range`);
    if (!validPos(card.pos)) add(`card ${id} has a position outside the board`);
    const zone = seen.get(id);
    if (zone !== "battlefield") {
      if (card.pos !== null) add(`card ${id} has a position but is not on the battlefield`);
      if (card.groupId !== null) add(`card ${id} has a group but is not on the battlefield`);
    }
    // An ungrouped battlefield card must say where it is: the UI never guesses.
    if (zone === "battlefield" && card.groupId === null && card.pos === null) add(`card ${id} is on the battlefield with no position`);
    if (card.groupId !== null) {
      if (!has(state.groups, card.groupId)) add(`card ${id} is in missing group ${card.groupId}`);
      if (card.pos !== null) add(`card ${id} has both a group and its own position`);
    }
    if (card.kind === "copy" && card.copiedFromId === null) add(`card ${id} is a copy with no source`);
  }

  for (const [gid, group] of Object.entries(state.groups)) {
    if (!validPos(group.anchor)) add(`group ${gid} anchor outside the board`);
    if (group.label.length > LIMITS.groupLabel) add(`group ${gid} label too long`);
    if (!ids.some((id) => state.cards[id].groupId === gid)) add(`group ${gid} is empty`);
  }

  // Trackers: finite integers within sensible bounds.
  const t = state.trackers;
  const bounded = (label: string, n: unknown, min: number) => {
    if (!isInt(n) || n < min || n > LIMITS.tracker) add(`tracker ${label} is not an integer in [${min}, ${LIMITS.tracker}]`);
  };
  bounded("life", t.life, -LIMITS.tracker);
  bounded("life2", t.life2, -LIMITS.tracker);
  bounded("poison", t.poison, 0);
  bounded("experience", t.experience, 0);
  bounded("energy", t.energy, 0);
  bounded("genericDamage", t.genericDamage, 0);
  for (const key of MANA_KEYS) bounded(`manaPool.${key}`, t.manaPool[key], 0);
  const damage = Object.entries(t.commanderDamage);
  if (damage.length > 50) add("too many commander damage entries");
  for (const [label, value] of damage) {
    if (label.length === 0 || label.length > LIMITS.groupLabel) add("commander damage label out of range");
    bounded(`commanderDamage.${label}`, value, 0);
  }

  if (!isInt(state.turn) || state.turn < 0 || state.turn > MAX_TURN) add("turn out of range");
  if (!isInt(state.opening.mulligans) || state.opening.mulligans < 0 || state.opening.mulligans > 60) add("mulligan count out of range");
  if (!Number.isFinite(state.seed) || !Number.isFinite(state.simulator.seed)) add("a seed is not finite");
  if (!(state.config.startingLife > 0 && state.config.startingLife <= LIMITS.tracker && isInt(state.config.startingLife))) add("startingLife out of range");
  for (const id of state.config.commanderIds) if (!has(state.cards, id)) add(`commander ${id} is not a game object`);

  // Events: bounded, strictly increasing, all below the counter.
  if (state.events.length > LIMITS.events) add("event log over its cap");
  let last = -1;
  for (const event of state.events) {
    if (!isInt(event.seq) || event.seq <= last) add(`event seq ${event.seq} is not increasing`);
    last = event.seq;
    if (event.seq >= state.nextEventSeq) add(`event seq ${event.seq} is at or above nextEventSeq`);
  }
  if (!isInt(state.nextEventSeq) || state.nextEventSeq < 0) add("nextEventSeq invalid");

  return problems;
}
