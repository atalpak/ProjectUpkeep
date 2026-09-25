/**
 * Snapshot migration (board/migrate.ts): one fixture per schema version, and
 * the converter is proven by running the OLD blob through the ordinary
 * validator, not by trusting the migrator's own output. The v1 fixture below
 * is a literal version-1 snapshot (the shape src/lib/playtest/board/types.ts
 * had before free placement), including the fields v2 dropped (`life`, `log`,
 * `imageUri`, a bare `groupId`).
 *
 * Run with: npx tsx --test scripts/playtest-board-migrate.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { validateSnapshot, SnapshotValidationError } from "../src/lib/playtest/board/serialize";
import { checkInvariants } from "../src/lib/playtest/board/invariants";
import { applyCommand } from "../src/lib/playtest/board/reduce";

function v1Card(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    kind: "deck-card",
    cardId: `scry-${id}`,
    oracleId: `orc-${id}`,
    name: `Card ${id}`,
    imageUri: `https://cards.scryfall.io/normal/${id}.jpg`,
    face: "front",
    tapped: false,
    rotation: 0,
    counters: {},
    note: null,
    copiedFromId: null,
    groupId: null,
    power: null,
    toughness: null,
    ...over,
  };
}

const V1_FIXTURE = {
  schemaVersion: 1,
  deckId: "deck-old",
  seed: 4242,
  turn: 4,
  life: 33,
  commanderDamage: { Atraxa: 7, Nobody: 0 },
  cards: {
    a: v1Card("a", { groupId: "Ramp", tapped: true, counters: { charge: 2 } }),
    b: v1Card("b", { groupId: "Ramp" }),
    c: v1Card("c", { groupId: "Beaters", note: "attacks" }),
    d: v1Card("d"),
    e: v1Card("e"),
    cmd: v1Card("cmd", { name: "Test Commander" }),
    lib1: v1Card("lib1"),
    tok: v1Card("tok", { kind: "token", cardId: null, oracleId: null, name: "Soldier", power: "1", toughness: "1", imageUri: null }),
  },
  zones: {
    library: ["lib1"],
    hand: [],
    battlefield: ["a", "b", "c", "d", "e", "tok"],
    graveyard: [],
    exile: [],
    command: ["cmd"],
    sideboard: [],
    temporary: [],
  },
  log: [{ id: "0", turn: 1, text: "Drew 7 cards." }],
};

test("a literal v1 snapshot upgrades to a valid v2 state", () => {
  const state = validateSnapshot(JSON.parse(JSON.stringify(V1_FIXTURE)));
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(checkInvariants(state), []);
  assert.equal(state.trackers.life, 33);
  assert.deepEqual(state.trackers.commanderDamage, { Atraxa: 7 }, "a zero entry is dropped");
  assert.equal(state.turn, 3, "v1 counted the opening as turn 1; v2 as turn 0");
  assert.equal(state.config.format, "commander");
  assert.deepEqual(state.config.commanderIds, ["cmd"]);
  assert.equal(state.opening.status, "kept");
  assert.equal(state.deckId, "deck-old");
});

test("v1 groups become row groups stacked down the board; ungrouped cards get positions of their own", () => {
  const state = validateSnapshot(JSON.parse(JSON.stringify(V1_FIXTURE)));
  assert.deepEqual(Object.keys(state.groups).sort(), ["Beaters", "Ramp"]);
  assert.equal(state.groups.Ramp.arrangement, "row");
  assert.ok(state.groups.Beaters.anchor.y > state.groups.Ramp.anchor.y, "each group gets its own band");
  assert.equal(state.cards.a.groupId, "Ramp");
  assert.equal(state.cards.a.pos, null);
  for (const id of ["d", "e", "tok"]) assert.notEqual(state.cards[id].pos, null, id);
  const positions = ["d", "e", "tok"].map((id) => JSON.stringify(state.cards[id].pos));
  assert.equal(new Set(positions).size, 3);
  assert.ok(state.cards.d.pos!.y > state.groups.Beaters.anchor.y, "loose cards sit below the group bands");
});

test("card state survives the upgrade and images map to both sizes", () => {
  const state = validateSnapshot(JSON.parse(JSON.stringify(V1_FIXTURE)));
  assert.equal(state.cards.a.tapped, true);
  assert.deepEqual(state.cards.a.counters, { charge: 2 });
  assert.equal(state.cards.c.note, "attacks");
  assert.equal(state.cards.a.imageSmall, "https://cards.scryfall.io/normal/a.jpg");
  assert.equal(state.cards.a.imageNormal, "https://cards.scryfall.io/normal/a.jpg");
  assert.equal(state.cards.tok.kind, "token");
  assert.equal(state.cards.tok.imageNormal, null);
});

test("the v1 text log cannot be structured: it is dropped and one import note stands in", () => {
  const state = validateSnapshot(JSON.parse(JSON.stringify(V1_FIXTURE)));
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].kind, "restore");
  assert.equal(state.nextEventSeq, 1);
  assert.ok(!JSON.stringify(state).includes("Drew 7 cards"));
});

test("the upgraded state is playable: commands apply and invariants hold", () => {
  let state = validateSnapshot(JSON.parse(JSON.stringify(V1_FIXTURE)));
  state = applyCommand(state, { type: "NEXT_TURN" });
  state = applyCommand(state, { type: "MOVE_MANY", ids: ["d", "e"], to: "graveyard", at: "bottom" });
  assert.deepEqual(checkInvariants(state), []);
  assert.equal(state.turn, 4);
});

test("the upgraded deck fingerprint can never equal a real one, so resume offers the honest choice", () => {
  const state = validateSnapshot(JSON.parse(JSON.stringify(V1_FIXTURE)));
  assert.equal(state.source.fingerprint, "0".repeat(64));
});

test("a malformed v1 blob is refused, not coerced", () => {
  const broken = JSON.parse(JSON.stringify(V1_FIXTURE)) as typeof V1_FIXTURE;
  (broken.cards.a as Record<string, unknown>).tapped = "yes";
  assert.throws(() => validateSnapshot(broken), SnapshotValidationError);
  const missing = JSON.parse(JSON.stringify(V1_FIXTURE)) as Record<string, unknown>;
  delete missing.cards;
  assert.doesNotThrow(() => 0);
  assert.throws(() => validateSnapshot({ ...missing, zones: { library: [], hand: [], battlefield: ["ghost"], graveyard: [], exile: [], command: [], sideboard: [], temporary: [] } }), SnapshotValidationError);
  const ghostZone = JSON.parse(JSON.stringify(V1_FIXTURE)) as typeof V1_FIXTURE;
  ghostZone.zones.hand = ["ghost"] as never;
  assert.throws(() => validateSnapshot(ghostZone), SnapshotValidationError);
});

test("version 2 is the current version and a v2 fixture round-trips unchanged", () => {
  const upgraded = validateSnapshot(JSON.parse(JSON.stringify(V1_FIXTURE)));
  const again = validateSnapshot(JSON.parse(JSON.stringify(upgraded)));
  assert.deepEqual(again, upgraded);
});
