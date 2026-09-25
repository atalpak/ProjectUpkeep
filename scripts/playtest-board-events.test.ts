/**
 * The structured log, its derived text, the public filter, metrics and the two
 * export formats (board/events.ts, metrics.ts, export.ts). Metrics are checked
 * against a KNOWN command fixture: a fixed script of plays whose totals are
 * worked out by hand in the assertions, so a chart that quietly counts
 * something else fails here.
 *
 * Run with: npx tsx --test scripts/playtest-board-events.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { describeEvent, publicEvents } from "../src/lib/playtest/board/events";
import { CONVENTIONS, computeMetrics, logWarnings } from "../src/lib/playtest/board/metrics";
import { compactLog, fullLogJson } from "../src/lib/playtest/board/export";
import { makeGameCard, makeState } from "../src/lib/playtest/board/fixtures";
import type { GameCommand } from "../src/lib/playtest/board/commands";
import type { GameState } from "../src/lib/playtest/board/types";

function known(): GameState {
  const cards = [
    makeGameCard("land1", "Forest", { typeLine: "Basic Land — Forest", manaValue: 0, producesMana: true }),
    makeGameCard("land2", "Forest", { typeLine: "Basic Land — Forest", manaValue: 0, producesMana: true }),
    makeGameCard("elf", "Llanowar Elves", { typeLine: "Creature — Elf Druid", manaValue: 1, producesMana: true, power: "1", toughness: "1" }),
    makeGameCard("bear", "Grizzly Bears", { typeLine: "Creature — Bear", manaValue: 2, power: "2", toughness: "2" }),
    makeGameCard("ring", "Sol Ring", { typeLine: "Artifact", manaValue: 1, producesMana: true }),
    makeGameCard("wrath", "Wrath of God", { typeLine: "Sorcery", manaValue: 4 }),
    makeGameCard("x1", "Filler 1"),
    makeGameCard("x2", "Filler 2"),
    makeGameCard("x3", "Filler 3"),
    makeGameCard("x4", "Filler 4"),
    makeGameCard("x5", "Filler 5"),
    makeGameCard("x6", "Filler 6"),
    makeGameCard("x7", "Filler 7"),
  ];
  return makeState(cards, { library: cards.map((c) => c.id) });
}

const SCRIPT: GameCommand[] = [
  { type: "DRAW", count: 5 }, // turn 0: land1 land2 elf bear ring
  { type: "NEXT_TURN" }, // turn 1 (on the play: no draw)
  { type: "MOVE_MANY", ids: ["land1"], to: "battlefield", at: "bottom" }, // land, mv 0
  { type: "MOVE_MANY", ids: ["elf"], to: "battlefield", at: "bottom" }, // creature, mv 1
  { type: "NEXT_TURN" }, // turn 2: draws wrath; producers 2 (land1, elf); power 1
  { type: "MOVE_MANY", ids: ["land2"], to: "battlefield", at: "bottom" },
  { type: "MOVE_MANY", ids: ["bear", "ring"], to: "battlefield", at: "bottom" }, // mv 2 + 1
  { type: "MILL", count: 2 },
  { type: "NEXT_TURN" }, // turn 3: draws; producers 4; power 3
];

function played(): GameState {
  let state = known();
  for (const command of SCRIPT) state = applyCommand(state, command);
  return state;
}

test("metrics match a known command fixture, turn by turn", () => {
  const metrics = computeMetrics(played().events);
  const at = (turn: number) => metrics.turns.find((t) => t.turn === turn)!;
  assert.equal(at(0).drawn, 5);
  assert.equal(at(1).drawn, 0, "turn one is on the play");
  assert.equal(at(1).playedMv.all, 1, "land (0) + elf (1)");
  assert.equal(at(1).playedMv.creature, 1);
  assert.equal(at(1).playedMv.other, 0);
  assert.equal(at(1).cardsPlayed, 2);
  assert.equal(at(2).drawn, 1, "the draw taken by Next turn is counted");
  assert.equal(at(2).producers, 2);
  assert.equal(at(2).power, 1);
  assert.equal(at(2).playedMv.all, 3, "land 0 + bear 2 + ring 1");
  assert.equal(at(2).playedMv.creature, 2);
  assert.equal(at(2).playedMv.other, 1);
  assert.equal(at(2).milled, 2);
  assert.equal(at(3).drawn, 1);
  assert.equal(at(3).producers, 4, "land1, land2, elf, ring");
  assert.equal(at(3).power, 3, "elf 1 + bear 2");
  assert.equal(metrics.partial, false);
});

test("a chart states what it counts", () => {
  for (const text of Object.values(CONVENTIONS)) assert.ok(text.length > 30);
  assert.match(CONVENTIONS.playedMv, /not mana paid/);
});

test("moving a card between non-battlefield zones does not count as played mana value", () => {
  let state = known();
  state = applyCommand(state, { type: "DRAW", count: 5 });
  state = applyCommand(state, { type: "MOVE_MANY", ids: ["wrath"], to: "graveyard", at: "bottom" });
  assert.equal(computeMetrics(state.events).turns.reduce((n, t) => n + t.playedMv.all, 0), 0);
});

test("a voided event is excluded from metrics and raises a warning that the log may not match the board", () => {
  const state = played();
  const drawEvent = state.events.find((e) => e.kind === "draw")!;
  const voided = applyCommand(state, { type: "VOID_EVENT", seq: drawEvent.seq, voided: true });
  const metrics = computeMetrics(voided.events);
  assert.equal(metrics.turns.find((t) => t.turn === 0)?.drawn ?? 0, 0);
  assert.equal(metrics.voided, 1);
  assert.equal(voided.zones.hand.length, state.zones.hand.length, "the board is untouched");
  assert.match(logWarnings(voided)[0], /removed by hand/);
  assert.deepEqual(logWarnings(state), []);
});

test("a trimmed log is reported as partial", () => {
  const metrics = computeMetrics(played().events, 40);
  assert.equal(metrics.partial, true);
  assert.match(logWarnings({ ...played(), eventsTruncatedBefore: 40 })[0], /trimmed/);
});

test("every event kind produces readable text with no undefined or object noise", () => {
  const state = played();
  for (const event of state.events) {
    const text = describeEvent(event);
    assert.ok(text.length > 3 && text.endsWith("."), text);
    assert.ok(!/undefined|\[object|NaN/.test(text), text);
  }
  const extra: GameCommand[] = [
    { type: "SET_CARD_FLAGS", ids: ["land1"], flags: { tapped: true, face: "face-down", rotation: 180, dimmed: true, ptOffset: { power: 1, toughness: 1 }, commanderTax: 2 } },
    { type: "ADD_COUNTER", cardId: "land1", name: "charge", delta: 2 },
    { type: "PROLIFERATE", ids: ["land1"] },
    { type: "CREATE_EXTRA", ids: ["tk"], spec: { name: "Treasure", power: null, toughness: null, imageSmall: null, imageNormal: null }, kind: "token", zone: "battlefield" },
    { type: "SET_TRACKER", path: "poison", value: 3 },
    { type: "ROLL", kind: "coin", result: 1 },
    { type: "SET_GROUP", ids: ["land1"], groupId: "g", group: { label: "Lands" } },
    { type: "SHUFFLE", zone: "library", seed: 3 },
    { type: "PEEK", zone: "library", from: "top", count: 1 },
    { type: "DELETE_OBJECT", cardId: "tk" },
  ];
  let s = state;
  for (const command of extra) s = applyCommand(s, command);
  for (const event of s.events) assert.ok(!/undefined|\[object|NaN/.test(describeEvent(event)), describeEvent(event));
});

test("the public filter turns draws and mills into counts and drops peeks, notes and simulator entries", () => {
  let state = played();
  state = applyCommand(state, { type: "PEEK", zone: "library", from: "top", count: 2 });
  state = applyCommand(state, { type: "SET_NOTE", cardId: "elf", note: "secret plan" });
  state = applyCommand(state, { type: "RECORD_INTERACTION", turn: 3, rerollIndex: 0, prompts: ["attack"], resolution: "pending" });
  const pub = publicEvents(state.events);
  assert.ok(pub.every((e) => e.ids.length === 0), "no object ids");
  assert.ok(!pub.some((e) => ["peek", "note", "interaction", "simulator"].includes(e.kind)));
  for (const e of pub.filter((e) => e.kind === "draw" || e.kind === "mill")) assert.deepEqual(e.names, []);
  const text = pub.map(describeEvent).join("\n");
  assert.ok(!text.includes("secret plan"));
  assert.ok(!text.includes("Wrath of God") || /Wrath of God/.test(text) === false, "a drawn card is not named");
});

test("a card played face down loses its name in the public log", () => {
  let state = known();
  state = applyCommand(state, { type: "DRAW", count: 5 });
  state = applyCommand(state, { type: "MOVE_MANY", ids: ["ring"], to: "battlefield", at: "bottom", faceDown: true });
  const pub = publicEvents(state.events).find((e) => e.kind === "move")!;
  assert.deepEqual(pub.names, []);
  assert.equal(pub.from, null, "the hidden origin is not disclosed either");
  assert.ok(!describeEvent(pub).includes("Sol Ring"));
});

test("compact text export groups by turn; the shareable one omits what the private one keeps", () => {
  let state = played();
  state = applyCommand(state, { type: "PEEK", zone: "library", from: "top", count: 1 });
  const privateText = compactLog(state, "private");
  const shareText = compactLog(state, "shareable");
  assert.match(privateText, /Opening hand/);
  assert.match(privateText, /Turn 1/);
  assert.match(privateText, /Looked at/);
  assert.ok(!/Looked at/.test(shareText));
  assert.ok(shareText.split("\n").filter((l) => l.startsWith("- ")).length < privateText.split("\n").filter((l) => l.startsWith("- ")).length);
});

test("the JSON export is versioned, and the shareable one carries no ids or seeds", () => {
  const state = applyCommand(played(), { type: "SHUFFLE", zone: "library", seed: 987654 });
  const priv = fullLogJson(state, "private");
  assert.equal(priv.version, 1);
  assert.equal(priv.kind, "upkeep-playtest-log");
  assert.ok(JSON.stringify(priv).includes("987654"), "the owner's own file keeps the seed");
  const share = fullLogJson(state, "shareable");
  const text = JSON.stringify(share);
  assert.ok(!text.includes("987654"));
  assert.ok(!/"ids"/.test(text));
  assert.ok(!text.includes("land1") && !text.includes("elf\""));
  assert.equal(share.audience, "shareable");
});

test("compact export notes when earlier turns were trimmed", () => {
  const text = compactLog({ ...played(), eventsTruncatedBefore: 12 }, "private");
  assert.match(text, /trimmed/);
});
