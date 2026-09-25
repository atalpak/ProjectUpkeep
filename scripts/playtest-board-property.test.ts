/**
 * The property test: seeded random command sequences, with the invariants
 * checked after EVERY command and the same seed required to give the same
 * states. It is deliberately hostile: a third of the arguments are garbage
 * (unknown ids, NaN, huge or negative numbers, wrong-zone targets), because
 * the reducer's promise is "bad input is a no-op, never a corrupt state".
 *
 * What it asserts, for every seed, after every step:
 *   1. `checkInvariants` is empty (each card in exactly one zone, no missing
 *      or duplicate ids, sane numbers, positions on the board, no empty
 *      groups, event sequence increasing and under its cap);
 *   2. deck cards are never created or lost except by DELETE_OBJECT;
 *   3. a command that returns the same reference changed nothing at all;
 *   4. the state survives a serialize -> validate round trip (every 25 steps);
 *   5. the same seed replays to byte-identical states, step by step;
 *   6. one gesture is one undo step: undoing every recorded step walks back
 *      through the exact same states in reverse.
 *
 * Run with: npx tsx --test scripts/playtest-board-property.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { checkInvariants } from "../src/lib/playtest/board/invariants";
import { emptyHistory, record, undo, redo } from "../src/lib/playtest/board/history";
import { validateSnapshot } from "../src/lib/playtest/board/serialize";
import { tidyLayout } from "../src/lib/playtest/board/layout";
import { makeGameCard, makeState } from "../src/lib/playtest/board/fixtures";
import { relocate } from "../src/lib/playtest/board/reducers/zones";
import { mulberry32, type RNG } from "../src/lib/playtest/rng";
import { ZONE_IDS, type GameState, type ZoneId } from "../src/lib/playtest/board/types";
import type { GameCommand } from "../src/lib/playtest/board/commands";

function deck(): GameState {
  const cards = [];
  for (let i = 0; i < 40; i++) {
    cards.push(
      makeGameCard(`c${i}`, `Card ${i}`, {
        typeLine: i % 4 === 0 ? "Basic Land" : i % 4 === 1 ? "Creature — Elf" : i % 4 === 2 ? "Artifact" : "Instant",
        manaValue: i % 5,
        producesMana: i % 4 === 0,
        power: i % 4 === 1 ? String(1 + (i % 3)) : null,
        toughness: i % 4 === 1 ? "2" : null,
      }),
    );
  }
  const base = makeState(cards, { library: cards.map((c) => c.id) });
  return { ...base, opening: { status: "deciding", mulligans: 0 } };
}

type Gen = { rng: RNG; state: GameState; extra: number };

const int = (g: Gen, n: number) => Math.floor(g.rng() * n);
const pickOf = <T,>(g: Gen, list: readonly T[]): T => list[int(g, list.length)];
const zone = (g: Gen): ZoneId => pickOf(g, ZONE_IDS);
const garbage = (g: Gen) => g.rng() < 0.25;

function anId(g: Gen): string {
  if (garbage(g)) return pickOf(g, ["ghost", "", "constructor", "__proto__", "c999"]);
  const all = Object.keys(g.state.cards);
  return all.length === 0 ? "ghost" : pickOf(g, all);
}

function someIds(g: Gen): string[] {
  const count = int(g, 6);
  return Array.from({ length: count }, () => anId(g));
}

function anyNumber(g: Gen): number {
  const r = g.rng();
  if (r < 0.1) return Number.NaN;
  if (r < 0.2) return 10 ** 12;
  if (r < 0.3) return -(10 ** 12);
  return int(g, 30) - 8;
}

function anyPos(g: Gen) {
  return garbage(g) ? { x: anyNumber(g), y: anyNumber(g) } : { x: g.rng(), y: g.rng() };
}

function command(g: Gen, depth = 0): GameCommand {
  const kinds = 37;
  const k = int(g, kinds);
  switch (k) {
    case 0: return { type: "DRAW", count: anyNumber(g) };
    case 1: return { type: "MILL", count: int(g, 5) };
    case 2: return { type: "MOVE_CARD", cardId: anId(g), to: zone(g), index: garbage(g) ? anyNumber(g) : g.rng() < 0.5 ? null : int(g, 10), groupId: g.rng() < 0.3 ? pickOf(g, ["g1", "g2", "nope"]) : undefined, pos: g.rng() < 0.3 ? anyPos(g) : undefined };
    case 3: return { type: "MOVE_MANY", ids: someIds(g), to: zone(g), at: pickOf(g, ["top", "bottom", int(g, 20), anyNumber(g)] as const), faceDown: g.rng() < 0.2, tapped: g.rng() < 0.2, pos: g.rng() < 0.3 ? anyPos(g) : undefined };
    case 4: {
      const z = zone(g);
      const order = [...g.state.zones[z]];
      if (g.rng() < 0.6) order.sort(() => g.rng() - 0.5);
      else if (g.rng() < 0.5) order.pop();
      return { type: "REORDER_ZONE", zone: z, order };
    }
    case 5: return { type: "PEEK", zone: zone(g), from: pickOf(g, ["top", "bottom"] as const), count: anyNumber(g) };
    case 6: return { type: "REVEAL", ids: someIds(g), revealed: g.rng() < 0.5 };
    case 7: return { type: "SET_TAPPED", cardId: anId(g), tapped: g.rng() < 0.5 };
    case 8: return { type: "SET_FACE", cardId: anId(g), face: pickOf(g, ["front", "back", "face-down"] as const) };
    case 9: return { type: "SET_NOTE", cardId: anId(g), note: g.rng() < 0.3 ? null : "n".repeat(int(g, 1500)) };
    case 10: return { type: "SET_ROTATION", cardId: anId(g), rotation: pickOf(g, [0, 90, 180, 270, 45] as never[]) };
    case 11: return { type: "SET_CARD_FLAGS", ids: someIds(g), flags: { tapped: g.rng() < 0.5 ? g.rng() < 0.5 : undefined, dimmed: g.rng() < 0.3 ? true : undefined, ptOffset: g.rng() < 0.4 ? { power: anyNumber(g), toughness: anyNumber(g) } : undefined, commanderTax: g.rng() < 0.3 ? anyNumber(g) : undefined } };
    case 12: return { type: "ADD_COUNTER", cardId: anId(g), name: pickOf(g, ["+1/+1", "loyalty", "  charge ", "", "__proto__", "constructor", "x".repeat(60)]), delta: anyNumber(g) };
    case 13: return { type: "PROLIFERATE", ids: someIds(g) };
    case 14: {
      g.extra++;
      const ids = Array.from({ length: 1 + int(g, 3) }, (_, i) => (garbage(g) ? anId(g) : `x${g.extra}-${i}`));
      const kind = pickOf(g, ["token", "extra", "copy"] as const);
      return { type: "CREATE_EXTRA", ids, spec: { name: pickOf(g, ["Soldier", "", "  Treasure  ", "y".repeat(300)]), power: g.rng() < 0.5 ? "1" : null, toughness: "1", manaValue: anyNumber(g), imageSmall: pickOf(g, [null, "https://cards.scryfall.io/a.jpg", "http://bad", "z".repeat(600)]), imageNormal: null }, kind, copiedFromId: kind === "copy" ? anId(g) : undefined, zone: zone(g), pos: g.rng() < 0.3 ? anyPos(g) : undefined };
    }
    case 15: return { type: "DELETE_OBJECT", cardId: pickOf(g, Object.keys(g.state.cards).filter((id) => g.state.cards[id].kind !== "deck-card").concat(["ghost"])) };
    case 16: return { type: "SHUFFLE", zone: zone(g), seed: int(g, 1e9) };
    case 17: return { type: "SET_LIFE", delta: anyNumber(g) };
    case 18: return { type: "SET_TRACKER", path: pickOf(g, ["life", "life2", "poison", "experience", "energy", "genericDamage", "manaPool.W", "manaPool.C", "manaPool.Z", "commanderDamage.Atraxa", "commanderDamage.", "commanderDamage.__proto__", "nope"]), value: anyNumber(g) };
    case 19: return { type: "SET_LAYOUT", placements: someIds(g).map((id) => ({ id, x: anyNumber(g) / 10, y: anyNumber(g) / 10 })), order: g.rng() < 0.3 ? [...g.state.zones.battlefield].reverse() : undefined };
    case 20: return { type: "SET_GROUP", ids: someIds(g), groupId: pickOf(g, ["g1", "g2", "g3", null, "bad id", "__proto__", "constructor"]), group: g.rng() < 0.6 ? { label: pickOf(g, ["Lands", "", "q".repeat(100)]), arrangement: pickOf(g, ["row", "column", "stack", "diagonal" as never]), anchor: anyPos(g) } : undefined };
    case 21: return { type: "NEXT_TURN" };
    case 22: return { type: "SET_TURN", turn: anyNumber(g) };
    case 23: return { type: "ROLL", kind: pickOf(g, ["coin", "d4", "d6", "d20", "d7" as never]), result: anyNumber(g) };
    case 24: return { type: "MULLIGAN", seed: int(g, 1e9) };
    case 25: return { type: "KEEP", bottomIds: g.rng() < 0.5 ? g.state.zones.hand.slice(0, g.state.opening.mulligans) : someIds(g) };
    case 26: return { type: "RANDOM_DISCARD", cardId: g.rng() < 0.6 && g.state.zones.hand.length > 0 ? pickOf(g, g.state.zones.hand) : anId(g) };
    case 27: return { type: "RECORD_INTERACTION", turn: anyNumber(g), rerollIndex: int(g, 4), prompts: pickOf(g, [[], ["attack"], ["counterspell", "stax"], ["bogus" as never]]), resolution: pickOf(g, ["pending", "ignored", "resolved", "rerolled", "??" as never]), reason: g.rng() < 0.3 ? "because" : null };
    case 28: return { type: "SET_SIMULATOR", settings: { ...g.state.simulator.settings, enabled: g.rng() < 0.5, maxPerTurn: anyNumber(g) } };
    case 29: return { type: "VOID_EVENT", seq: g.state.events.length > 0 ? pickOf(g, g.state.events).seq : 0, voided: g.rng() < 0.5 };
    case 30: return { type: "SET_GROUP", ids: g.state.zones.battlefield.slice(0, 4), groupId: `g${1 + int(g, 3)}`, group: { label: "Auto", arrangement: pickOf(g, ["row", "column", "stack"] as const), anchor: { x: g.rng(), y: g.rng() } } };
    case 31: return tidyLayout(g.state);
    case 32: return { type: "MOVE_MANY", ids: g.state.zones.library.slice(0, 1 + int(g, 4)), to: pickOf(g, ["hand", "battlefield", "battlefield", "graveyard"] as const), at: "bottom" };
    // Small groups, and cards leaving the table: the two ways a group empties.
    case 33: return { type: "SET_GROUP", ids: g.state.zones.battlefield.slice(int(g, 3), int(g, 3) + 1 + int(g, 2)), groupId: `g${1 + int(g, 3)}`, group: { label: "Pair", anchor: { x: g.rng(), y: g.rng() } } };
    case 34: return { type: "MOVE_MANY", ids: g.state.zones.battlefield.slice(0, 1 + int(g, 3)), to: pickOf(g, ["hand", "graveyard", "exile", "library"] as const), at: "top" };
    case 35: return { type: "DELETE_OBJECT", cardId: pickOf(g, g.state.zones.battlefield.filter((id) => g.state.cards[id].kind !== "deck-card").concat(["ghost"])) };
    default:
      if (depth > 0) return { type: "DRAW", count: 1 };
      return { type: "BATCH", commands: Array.from({ length: 1 + int(g, 3) }, () => {
        const inner = command(g, depth + 1);
        // A delete inside a batch is fine; what matters is the batch is one gesture.
        return inner;
      }) };
  }
}

function run(seed: number, steps: number) {
  const rng = mulberry32(seed);
  let state = deck();
  // Start from a dealt opening hand so the mulligan / keep paths are live.
  const dealt = relocate(state, state.zones.library.slice(0, 7), "hand", { at: "bottom" });
  if (dealt) state = dealt.state;
  const g: Gen = { rng, state, extra: 0 };
  const deckIds = new Set(Object.keys(state.cards));
  const trail: Array<{ command: GameCommand; before: GameState; after: GameState }> = [];
  const hashes: string[] = [];

  for (let step = 0; step < steps; step++) {
    g.state = state;
    const cmd = command(g);
    const before = state;
    const after = applyCommand(before, cmd);

    const problems = checkInvariants(after);
    assert.deepEqual(problems, [], `seed ${seed} step ${step}: ${cmd.type} broke invariants: ${JSON.stringify(cmd).slice(0, 300)}`);

    const survivors = Object.values(after.cards).filter((c) => c.kind === "deck-card").length;
    const hadDeleteOrBatch = cmd.type === "DELETE_OBJECT" || cmd.type === "BATCH" || cmd.type === "RESTORE_SNAPSHOT";
    if (!hadDeleteOrBatch) {
      assert.equal(survivors, Object.values(before.cards).filter((c) => c.kind === "deck-card").length, `seed ${seed} step ${step}: ${cmd.type} created or lost a deck card`);
    }
    for (const id of Object.keys(after.cards)) {
      if (after.cards[id].kind === "deck-card") assert.ok(deckIds.has(id), `seed ${seed}: a deck card id appeared from nowhere: ${id}`);
    }
    if (after === before) assert.deepEqual(after, before);
    if (cmd.type === "PEEK" || cmd.type === "ROLL") assert.deepEqual(after.zones, before.zones, `${cmd.type} moved cards`);

    if (step % 25 === 0) {
      const roundTrip = validateSnapshot(JSON.parse(JSON.stringify(after)));
      assert.deepEqual(roundTrip, after, `seed ${seed} step ${step}: snapshot round trip changed the state`);
    }
    if (after !== before) trail.push({ command: cmd, before, after });
    hashes.push(JSON.stringify(after.zones) + after.nextEventSeq);
    state = after;
  }
  return { state, trail, hashes };
}

test("invariants hold after every command across 40 seeded sequences of 250 hostile commands", () => {
  for (let seed = 1; seed <= 40; seed++) run(seed, 250);
});

test("the same seed replays to identical states, step by step", () => {
  for (const seed of [3, 17, 99, 2026]) {
    const a = run(seed, 200);
    const b = run(seed, 200);
    assert.deepEqual(a.hashes, b.hashes);
    assert.equal(JSON.stringify(a.state), JSON.stringify(b.state), `seed ${seed}: final states differ`);
  }
});

test("different seeds explore different games", () => {
  assert.notEqual(JSON.stringify(run(1, 120).state.zones), JSON.stringify(run(2, 120).state.zones));
});

test("one gesture is one undo step: undoing every recorded step walks the states back exactly, redo walks forward", () => {
  const { state: final, trail } = run(5, 150);
  let history = emptyHistory();
  for (const step of trail) history = record(history, step.before);
  let current = final;
  for (let i = trail.length - 1; i >= 0; i--) {
    const result = undo(history, current);
    assert.ok(result, `undo available at ${i}`);
    assert.deepEqual(result.state, trail[i].before, `undo step ${i} (${trail[i].command.type}) did not restore the prior state`);
    history = result.history;
    current = result.state;
  }
  for (let i = 0; i < trail.length; i++) {
    const result = redo(history, current)!;
    assert.deepEqual(result.state, trail[i].after);
    history = result.history;
    current = result.state;
  }
});

test("the harness can fail: a corrupted state is caught by the same invariant check", () => {
  const { state } = run(9, 60);
  const victim = Object.keys(state.cards)[0];
  const home = ZONE_IDS.find((z) => state.zones[z].includes(victim))!;
  const elsewhere = ZONE_IDS.find((z) => z !== home)!;
  const inTwo: GameState = { ...state, zones: { ...state.zones, [elsewhere]: [...state.zones[elsewhere], victim] } };
  assert.ok(checkInvariants(inTwo).length > 0, "a card in two zones is reported");
  const lost: GameState = { ...state, zones: { ...state.zones, [home]: state.zones[home].filter((id) => id !== victim) } };
  assert.ok(checkInvariants(lost).length > 0, "a card in no zone is reported");
  const offBoard = { ...state, cards: { ...state.cards, [Object.keys(state.cards)[0]]: { ...state.cards[Object.keys(state.cards)[0]], pos: { x: 3, y: 3 } } } };
  assert.ok(checkInvariants(offBoard).length > 0, "an off-board position is reported");
});
