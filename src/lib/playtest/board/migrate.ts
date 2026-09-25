/**
 * Snapshot migration, one step per version, run BEFORE the strict reader in
 * serialize.ts so an old blob is upgraded and then validated exactly like a
 * new one (never trusted because it "looks old").
 *
 * v1 -> v2. Version 1 was the rows-and-groups board: `life` and
 * `commanderDamage` at the top level, a text `log`, `imageUri` on cards, and a
 * group as nothing but a `groupId` string on a card. No v1 snapshot was ever
 * stored (it shipped without persistence), so this exists for a pasted or
 * hand-kept blob and for the fixture that proves the upgrade path works; it is
 * still written defensively because a v1 blob is untrusted input like any
 * other.
 *
 *  - each distinct groupId becomes a "row" group, stacked down the board;
 *  - ungrouped battlefield cards get grid positions below the group rows;
 *  - the v1 text log cannot become structured events, so it is dropped and one
 *    "restore" event notes the import;
 *  - the deck fingerprint is unknown, so it is the all-zero fingerprint, which
 *    never equals a real one: the resume prompt will offer "Start with current
 *    deck", which is the honest thing.
 */

import { CARD_W, CARD_H } from "./layout";
import { defaultSimulatorSettings } from "./types";

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns a v2-shaped candidate (still unvalidated) from a v1 blob, or null
 *  when `data` is not a v1 snapshot at all. */
export function migrateV1ToV2(data: Rec): Rec {
  const cardsIn = isRecord(data.cards) ? data.cards : {};
  const zonesIn = isRecord(data.zones) ? data.zones : {};
  const battlefield = Array.isArray(zonesIn.battlefield) ? (zonesIn.battlefield as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const command = Array.isArray(zonesIn.command) ? (zonesIn.command as unknown[]).filter((v): v is string => typeof v === "string") : [];

  const groupIds: string[] = [];
  for (const id of battlefield) {
    const card = cardsIn[id];
    const gid = isRecord(card) && typeof card.groupId === "string" ? card.groupId : null;
    if (gid && !groupIds.includes(gid)) groupIds.push(gid);
  }
  const groups: Rec = {};
  groupIds.forEach((gid, i) => {
    groups[gid] = { label: gid.slice(0, 60), arrangement: "row", anchor: { x: 0.04, y: Math.min(0.04 + i * (CARD_H + 0.03), 1 - CARD_H) } };
  });

  let loose = 0;
  const cards: Rec = {};
  for (const [id, raw] of Object.entries(cardsIn)) {
    if (!isRecord(raw)) {
      cards[id] = raw;
      continue;
    }
    const onBattlefield = battlefield.includes(id);
    const gid = onBattlefield && typeof raw.groupId === "string" ? raw.groupId : null;
    let pos: Rec | null = null;
    if (onBattlefield && !gid) {
      const col = loose % 10;
      const row = Math.floor(loose / 10);
      loose++;
      pos = {
        x: Math.min(0.04 + col * CARD_W * 1.1, 1 - CARD_W),
        y: Math.min(0.04 + (groupIds.length + row) * (CARD_H + 0.03), 1 - CARD_H),
      };
    }
    const image = typeof raw.imageUri === "string" ? raw.imageUri : null;
    cards[id] = {
      id: raw.id,
      kind: raw.kind,
      cardId: raw.cardId ?? null,
      oracleId: raw.oracleId ?? null,
      name: raw.name,
      typeLine: null,
      manaValue: null,
      producesMana: false,
      imageSmall: image,
      imageNormal: image,
      imageBack: null,
      face: raw.face,
      tapped: raw.tapped,
      rotation: raw.rotation,
      dimmed: false,
      revealed: false,
      counters: raw.counters,
      note: raw.note ?? null,
      copiedFromId: raw.copiedFromId ?? null,
      groupId: gid,
      power: raw.power ?? null,
      toughness: raw.toughness ?? null,
      ptOffset: { power: 0, toughness: 0 },
      commanderTax: 0,
      pos,
    };
  }

  const commanderDamage: Rec = {};
  if (isRecord(data.commanderDamage)) {
    for (const [label, value] of Object.entries(data.commanderDamage)) {
      if (typeof value === "number" && value > 0) commanderDamage[label] = value;
    }
  }
  const life = typeof data.life === "number" ? data.life : 20;
  const seed = typeof data.seed === "number" ? data.seed : 0;

  return {
    schemaVersion: 2,
    deckId: data.deckId,
    source: { fingerprint: "0".repeat(64), deckSize: Object.keys(cardsIn).length },
    seed,
    config: {
      format: command.length > 0 ? "commander" : "constructed",
      startingLife: command.length > 0 ? 40 : 20,
      freeMulligan: "none",
      firstTurnDraws: false,
      commanderIds: command,
    },
    opening: { status: "kept", mulligans: 0 },
    turn: typeof data.turn === "number" ? Math.max(0, Math.trunc(data.turn) - 1) : 0,
    trackers: {
      life,
      life2: life,
      poison: 0,
      experience: 0,
      energy: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commanderDamage,
      genericDamage: 0,
    },
    cards,
    zones: zonesIn,
    groups,
    events: [
      {
        seq: 0,
        gestureId: 0,
        turn: 0,
        ts: 0,
        kind: "restore",
        ids: [],
        names: [],
        from: null,
        to: null,
        data: {},
        voided: false,
        private: true,
      },
    ],
    nextEventSeq: 1,
    eventsTruncatedBefore: null,
    simulator: { settings: defaultSimulatorSettings(), seed: (seed ^ 0x5bd1e995) >>> 0, results: [] },
  };
}
