/**
 * The public projection of a game: what a signed-in reader holding a share
 * link (or the pop-out window) is allowed to see.
 *
 * READ THIS BEFORE CHANGING IT. A share is NOT a copy of the owner's
 * snapshot with the private parts deleted. `GameState` holds the library's
 * order, the hand, the shuffle seed (seed + decklist rebuilds the library
 * order exactly) and free-text notes; any "copy it and delete the secret
 * fields" approach leaks the next field somebody adds. So the projection is
 * built the other way round, from nothing, field by field, from an allow-list:
 *
 *  - hand: a COUNT, unless `showHand` (an affirmative choice), and then only
 *    display fields, never internal ids;
 *  - library and sideboard: a count. No order, no identities, no top card;
 *  - face-down cards: shown as face-down, with no name, card id, image or note;
 *  - object ids are replaced with fresh per-share refs (p0..pn), so nothing
 *    joins back to the owner's game;
 *  - no seeds of any kind (game, shuffle, simulator), no deck id, no
 *    fingerprint, no owner, and NO notes;
 *  - the log is `publicEvents()`: draws and mills as counts, no peeks, no
 *    simulator prompts;
 *  - images only if they are https on cards.scryfall.io: a custom token's
 *    image URL is arbitrary text, and the reader's browser would fetch it.
 *
 * `scripts/playtest-share-projection.test.ts` plants uniquely named secrets in
 * every hidden place and asserts none survive JSON.stringify of the result.
 * `readProjection` re-validates on the way OUT of the database, because the
 * owner can write the jsonb column directly and the reader must not trust it.
 */

import { describeEvent, publicEvents } from "./events";
import { resolvedPositions } from "./layout";
import { has } from "./reducers/util";
import { MANA_KEYS, type GameCard, type GameState, type ZoneId } from "./types";

export const PROJECTION_VERSION = 1;

export type PublicCard = {
  /** Fresh per-projection id; meaningless outside it. */
  ref: string;
  faceDown: boolean;
  name: string | null;
  typeLine: string | null;
  manaValue: number | null;
  imageSmall: string | null;
  imageNormal: string | null;
  tapped: boolean;
  rotation: 0 | 90 | 180 | 270;
  dimmed: boolean;
  counters: Record<string, number>;
  power: string | null;
  toughness: string | null;
  ptOffset: { power: number; toughness: number };
  /** Top-left, as a fraction of the board; battlefield only. */
  x: number | null;
  y: number | null;
};

export type PublicZones = Record<"battlefield" | "graveyard" | "exile" | "command" | "temporary", PublicCard[]>;

export type PublicProjection = {
  version: number;
  format: "commander" | "constructed";
  turn: number;
  trackers: {
    life: number;
    life2: number;
    poison: number;
    experience: number;
    energy: number;
    manaPool: Record<"W" | "U" | "B" | "R" | "G" | "C", number>;
    commanderDamage: Record<string, number>;
    genericDamage: number;
  };
  zones: PublicZones;
  counts: { library: number; hand: number; sideboard: number };
  /** null unless the owner chose to show it. */
  hand: PublicCard[] | null;
  log: Array<{ turn: number; text: string }>;
  logPartial: boolean;
};

const PUBLIC_ZONE_LIST = ["battlefield", "graveyard", "exile", "command", "temporary"] as const;

export function isPublicImage(url: string | null): string | null {
  if (!url || url.length > 300) return null;
  return /^https:\/\/cards\.scryfall\.io\/[A-Za-z0-9/_.\-?=&%]+$/.test(url) ? url : null;
}

function projectCard(card: GameCard, ref: string, position: { x: number; y: number } | undefined): PublicCard {
  const hidden = card.face === "face-down";
  const showBack = card.face === "back";
  return {
    ref,
    faceDown: hidden,
    name: hidden ? null : card.name,
    typeLine: hidden ? null : card.typeLine,
    manaValue: hidden ? null : card.manaValue,
    imageSmall: hidden ? null : isPublicImage(showBack ? card.imageBack : card.imageSmall),
    imageNormal: hidden ? null : isPublicImage(showBack ? card.imageBack : card.imageNormal),
    tapped: card.tapped,
    rotation: card.rotation,
    dimmed: card.dimmed,
    counters: { ...card.counters },
    power: hidden ? null : card.power,
    toughness: hidden ? null : card.toughness,
    ptOffset: { power: card.ptOffset.power, toughness: card.ptOffset.toughness },
    x: position ? position.x : null,
    y: position ? position.y : null,
  };
}

export function projectPublic(state: GameState, options: { showHand: boolean }): PublicProjection {
  let next = 0;
  const ref = () => `p${next++}`;
  const positions = resolvedPositions(state);

  const zones = {} as PublicZones;
  for (const zone of PUBLIC_ZONE_LIST) {
    zones[zone] = state.zones[zone as ZoneId].map((id) => projectCard(state.cards[id], ref(), zone === "battlefield" ? positions.get(id) : undefined));
  }
  const hand = options.showHand ? state.zones.hand.map((id) => projectCard(state.cards[id], ref(), undefined)) : null;

  const t = state.trackers;
  const manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const key of MANA_KEYS) manaPool[key] = t.manaPool[key];

  return {
    version: PROJECTION_VERSION,
    format: state.config.format,
    turn: state.turn,
    trackers: {
      life: t.life,
      life2: t.life2,
      poison: t.poison,
      experience: t.experience,
      energy: t.energy,
      manaPool,
      commanderDamage: { ...t.commanderDamage },
      genericDamage: t.genericDamage,
    },
    zones,
    counts: { library: state.zones.library.length, hand: state.zones.hand.length, sideboard: state.zones.sideboard.length },
    hand,
    log: publicEvents(state.events).map((e) => ({ turn: e.turn, text: describeEvent(e) })),
    logPartial: state.eventsTruncatedBefore !== null || state.events.some((e) => e.voided),
  };
}

/* -------------------------------------------------------------------------- */
/* Reading a projection back out of storage.                                    */
/* -------------------------------------------------------------------------- */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

function readCard(value: unknown): PublicCard | null {
  if (!isRec(value)) return null;
  const ref = text(value.ref, 12);
  const rotation = value.rotation;
  if (ref === null || (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270)) return null;
  if (typeof value.faceDown !== "boolean" || typeof value.tapped !== "boolean" || typeof value.dimmed !== "boolean") return null;
  const counters: Record<string, number> = {};
  if (!isRec(value.counters)) return null;
  const entries = Object.entries(value.counters);
  if (entries.length > 30) return null;
  for (const [name, count] of entries) {
    const n = int(count, 1, 9999);
    if (n === null || name.length > 40 || name === "__proto__") return null;
    counters[name] = n;
  }
  const offset = isRec(value.ptOffset) ? value.ptOffset : null;
  const power = offset ? int(offset.power, -99, 99) : null;
  const toughness = offset ? int(offset.toughness, -99, 99) : null;
  if (power === null || toughness === null) return null;
  const coord = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
  const hidden = value.faceDown === true;
  return {
    ref,
    faceDown: hidden,
    name: hidden ? null : text(value.name, 200),
    typeLine: hidden ? null : text(value.typeLine, 200),
    manaValue: hidden ? null : int(value.manaValue, 0, 99),
    imageSmall: hidden ? null : isPublicImage(text(value.imageSmall, 300)),
    imageNormal: hidden ? null : isPublicImage(text(value.imageNormal, 300)),
    tapped: value.tapped,
    rotation,
    dimmed: value.dimmed,
    counters,
    power: hidden ? null : text(value.power, 8),
    toughness: hidden ? null : text(value.toughness, 8),
    ptOffset: { power, toughness },
    x: coord(value.x),
    y: coord(value.y),
  };
}

function readCards(value: unknown, max: number): PublicCard[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const cards: PublicCard[] = [];
  for (const item of value) {
    const card = readCard(item);
    if (!card) return null;
    cards.push(card);
  }
  return cards;
}

/** Validates a projection read from the database. Returns null when it is not
 *  a well-formed projection; the share page then shows "unavailable" rather
 *  than rendering whatever an owner wrote into the column. */
export function readProjection(value: unknown): PublicProjection | null {
  if (!isRec(value) || value.version !== PROJECTION_VERSION) return null;
  const format = value.format === "commander" || value.format === "constructed" ? value.format : null;
  const turn = int(value.turn, 0, 9999);
  if (!format || turn === null || !isRec(value.trackers) || !isRec(value.zones) || !isRec(value.counts)) return null;

  const tr = value.trackers;
  const life = int(tr.life, -9999, 9999);
  const life2 = int(tr.life2, -9999, 9999);
  const poison = int(tr.poison, 0, 9999);
  const experience = int(tr.experience, 0, 9999);
  const energy = int(tr.energy, 0, 9999);
  const genericDamage = int(tr.genericDamage, 0, 9999);
  if ([life, life2, poison, experience, energy, genericDamage].some((n) => n === null) || !isRec(tr.manaPool) || !isRec(tr.commanderDamage)) return null;
  const manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const key of MANA_KEYS) {
    const n = int(tr.manaPool[key], 0, 9999);
    if (n === null) return null;
    manaPool[key] = n;
  }
  const commanderDamage: Record<string, number> = {};
  const damageEntries = Object.entries(tr.commanderDamage);
  if (damageEntries.length > 50) return null;
  for (const [label, n] of damageEntries) {
    const v = int(n, 0, 9999);
    if (v === null || label.length > 60 || label === "__proto__") return null;
    commanderDamage[label] = v;
  }

  const zones = {} as PublicZones;
  for (const zone of PUBLIC_ZONE_LIST) {
    if (!has(value.zones, zone)) return null;
    const cards = readCards(value.zones[zone], 1500);
    if (!cards) return null;
    zones[zone] = cards;
  }
  const hand = value.hand === null ? null : readCards(value.hand, 200);
  if (value.hand !== null && hand === null) return null;

  const library = int(value.counts.library, 0, 1500);
  const handCount = int(value.counts.hand, 0, 1500);
  const sideboard = int(value.counts.sideboard, 0, 1500);
  if (library === null || handCount === null || sideboard === null) return null;

  if (!Array.isArray(value.log) || value.log.length > 1000) return null;
  const log: PublicProjection["log"] = [];
  for (const entry of value.log) {
    if (!isRec(entry)) return null;
    const entryTurn = int(entry.turn, 0, 9999);
    const line = text(entry.text, 500);
    if (entryTurn === null || line === null) return null;
    log.push({ turn: entryTurn, text: line });
  }

  return {
    version: PROJECTION_VERSION,
    format,
    turn,
    trackers: { life: life!, life2: life2!, poison: poison!, experience: experience!, energy: energy!, manaPool, commanderDamage, genericDamage: genericDamage! },
    zones,
    counts: { library, hand: handCount, sideboard },
    hand,
    log,
    logPartial: value.logPartial === true,
  };
}
