/**
 * Table geometry (board/layout.ts): proportional coordinates, derived group
 * positions, area select, snapping guides and the Tidy command. Pure maths, so
 * none of this needs a DOM, which is the point of keeping it out of the UI.
 *
 * Run with: npx tsx --test scripts/playtest-board-layout.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import {
  CARD_H,
  CARD_W,
  cardRect,
  cardsInRect,
  clampPos,
  defaultPos,
  groupCardPos,
  readingOrder,
  resolvedPositions,
  snapPosition,
  tidyLayout,
} from "../src/lib/playtest/board/layout";
import { checkInvariants } from "../src/lib/playtest/board/invariants";
import { makeGameCard, makeState } from "../src/lib/playtest/board/fixtures";
import type { GameState } from "../src/lib/playtest/board/types";

function table(): GameState {
  const cards = [
    makeGameCard("f1", "Forest", { typeLine: "Basic Land — Forest" }),
    makeGameCard("f2", "Forest", { typeLine: "Basic Land — Forest" }),
    makeGameCard("b1", "Bear", { typeLine: "Creature — Bear" }),
    makeGameCard("b2", "Bear", { typeLine: "Creature — Bear" }),
    makeGameCard("r1", "Sol Ring", { typeLine: "Artifact" }),
  ];
  return applyCommand(makeState(cards, { library: cards.map((c) => c.id) }), { type: "MOVE_MANY", ids: cards.map((c) => c.id), to: "battlefield", at: "bottom" });
}

test("positions are clamped onto the board and rounded to four places", () => {
  assert.deepEqual(clampPos({ x: -3, y: 9 }), { x: 0, y: Number((1 - CARD_H).toFixed(4)) });
  assert.equal(clampPos({ x: 0.123456789, y: 0.5 }).x, 0.1235);
  assert.deepEqual(clampPos({ x: Number.NaN, y: Number.POSITIVE_INFINITY }).x, 0);
  assert.ok(clampPos({ x: 1, y: 0 }).x + CARD_W <= 1 + 1e-9, "a card is never placed hanging off the board");
});

test("group positions are derived from the anchor and arrangement, never stored", () => {
  const anchor = { x: 0.2, y: 0.3 };
  assert.deepEqual(groupCardPos({ label: "r", arrangement: "row", anchor }, 0), { x: 0.2, y: 0.3 });
  assert.ok(groupCardPos({ label: "r", arrangement: "row", anchor }, 2).x > groupCardPos({ label: "r", arrangement: "row", anchor }, 1).x);
  assert.equal(groupCardPos({ label: "c", arrangement: "column", anchor }, 3).x, 0.2);
  assert.ok(groupCardPos({ label: "c", arrangement: "column", anchor }, 3).y > 0.3);
  const s0 = groupCardPos({ label: "s", arrangement: "stack", anchor }, 0);
  const s1 = groupCardPos({ label: "s", arrangement: "stack", anchor }, 1);
  assert.ok(s1.x > s0.x && s1.y > s0.y, "a stack fans down and to the right");

  let state = table();
  state = applyCommand(state, { type: "SET_GROUP", ids: ["b1", "b2"], groupId: "g", group: { label: "Bears", arrangement: "row", anchor } });
  const before = resolvedPositions(state);
  state = applyCommand(state, { type: "SET_GROUP", ids: [], groupId: "g", group: { anchor: { x: 0.5, y: 0.5 } } });
  const after = resolvedPositions(state);
  assert.notDeepEqual(before.get("b1"), after.get("b1"));
  assert.equal(state.cards.b1.pos, null, "moving the group wrote nothing onto the cards");
  assert.deepEqual(checkInvariants(state), []);
});

test("cards entering the table never stack exactly on top of each other", () => {
  const state = table();
  const seen = new Set([...resolvedPositions(state).values()].map((p) => `${p.x},${p.y}`));
  assert.equal(seen.size, 5);
  const spot = defaultPos(state);
  assert.ok(![...resolvedPositions(state).values()].some((p) => p.x === spot.x && p.y === spot.y));
});

test("a tapped card occupies a sideways rectangle about the same centre", () => {
  const upright = cardRect({ rotation: 0, tapped: false }, { x: 0.2, y: 0.2 });
  const tapped = cardRect({ rotation: 0, tapped: true }, { x: 0.2, y: 0.2 });
  assert.ok(Math.abs(upright.x + upright.w / 2 - (tapped.x + tapped.w / 2)) < 1e-9);
  assert.ok(Math.abs(upright.y + upright.h / 2 - (tapped.y + tapped.h / 2)) < 1e-9);
  assert.ok(tapped.w > upright.w * 1.2, "sideways is wider");
  assert.equal(cardRect({ rotation: 90, tapped: false }, { x: 0.2, y: 0.2 }).w, tapped.w);
});

test("area select returns the cards a rectangle touches, in stacking order", () => {
  let state = table();
  state = applyCommand(state, {
    type: "SET_LAYOUT",
    placements: [
      { id: "f1", x: 0.1, y: 0.1 },
      { id: "f2", x: 0.2, y: 0.1 },
      { id: "b1", x: 0.7, y: 0.6 },
      { id: "b2", x: 0.8, y: 0.6 },
      { id: "r1", x: 0.4, y: 0.4 },
    ],
  });
  assert.deepEqual(cardsInRect(state, { x: 0.05, y: 0.05, w: 0.3, h: 0.3 }), ["f1", "f2"]);
  assert.deepEqual(cardsInRect(state, { x: 0.65, y: 0.55, w: 0.3, h: 0.3 }), ["b1", "b2"]);
  assert.deepEqual(cardsInRect(state, { x: 0, y: 0, w: 1, h: 1 }).length, 5);
  assert.deepEqual(cardsInRect(state, { x: 0.9, y: 0.0, w: 0.05, h: 0.05 }), []);
  // Grouped cards are selectable through their derived positions.
  const grouped = applyCommand(state, { type: "SET_GROUP", ids: ["b1"], groupId: "g", group: { anchor: { x: 0.02, y: 0.7 } } });
  assert.deepEqual(cardsInRect(grouped, { x: 0, y: 0.65, w: 0.2, h: 0.3 }), ["b1"]);
});

test("snapping pulls edges and centres onto neighbours within the threshold and reports the guide", () => {
  const result = snapPosition({ x: 0.302, y: 0.5 }, [{ x: 0.3, y: 0.1 }]);
  assert.equal(result.pos.x, 0.3);
  assert.equal(result.guideX, 0.3);
  assert.equal(result.guideY, null, "too far vertically to snap");
  const far = snapPosition({ x: 0.6, y: 0.6 }, [{ x: 0.3, y: 0.1 }]);
  assert.deepEqual(far.pos, { x: 0.6, y: 0.6 });
  assert.equal(far.guideX, null);
  const centre = snapPosition({ x: 0.3 + 0.004, y: 0.6 }, [{ x: 0.3, y: 0.1 }]);
  assert.equal(centre.pos.x, 0.3);
  assert.deepEqual(snapPosition({ x: 0.5, y: 0.5 }, []).pos, { x: 0.5, y: 0.5 });
});

test("Tidy lays out creatures, other permanents, then lands in rows, as one undo step", () => {
  let state = table();
  state = applyCommand(state, { type: "SET_GROUP", ids: ["b1", "r1"], groupId: "g", group: { label: "Mixed", anchor: { x: 0.4, y: 0.4 } } });
  const command = tidyLayout(state);
  assert.equal(command.type, "BATCH", "dissolving a group and placing cards is one command");
  const before = state.events.length;
  const tidy = applyCommand(state, command);
  assert.deepEqual(checkInvariants(tidy), []);
  assert.deepEqual(tidy.groups, {}, "tidy dissolves groups");
  assert.ok(tidy.events.length > before);
  const y = (id: string) => tidy.cards[id].pos!.y;
  assert.ok(y("b1") < y("r1") && y("r1") < y("f1"), "creatures above other permanents above lands");
  assert.equal(y("b1"), y("b2"));
  assert.equal(y("f1"), y("f2"));
  assert.deepEqual(tidy.zones.battlefield, state.zones.battlefield, "stacking order is left alone");

  const again = applyCommand(tidy, tidyLayout(tidy));
  assert.deepEqual(Object.values(again.cards).map((c) => c.pos), Object.values(tidy.cards).map((c) => c.pos), "tidy is idempotent");
});

test("Tidy on a huge board stays on the board", () => {
  const cards = Array.from({ length: 120 }, (_, i) => makeGameCard(`c${i}`, `Card ${i % 7}`, { typeLine: i % 3 === 0 ? "Land" : "Creature" }));
  let state = makeState(cards, { library: cards.map((c) => c.id) });
  state = applyCommand(state, { type: "MOVE_MANY", ids: cards.map((c) => c.id), to: "battlefield", at: "bottom" });
  const tidy = applyCommand(state, tidyLayout(state));
  assert.deepEqual(checkInvariants(tidy), []);
  for (const card of Object.values(tidy.cards)) {
    assert.ok(card.pos!.x >= 0 && card.pos!.x + CARD_W <= 1.0001);
    assert.ok(card.pos!.y >= 0 && card.pos!.y + CARD_H <= 1.0001);
  }
});

test("reading order (screen readers, tab order) is top to bottom then left to right", () => {
  let state = table();
  state = applyCommand(state, {
    type: "SET_LAYOUT",
    placements: [{ id: "f1", x: 0.5, y: 0.1 }, { id: "f2", x: 0.1, y: 0.1 }, { id: "b1", x: 0.3, y: 0.6 }, { id: "b2", x: 0.05, y: 0.6 }, { id: "r1", x: 0.9, y: 0.35 }],
  });
  assert.deepEqual(readingOrder(state, state.zones.battlefield), ["f2", "f1", "r1", "b2", "b1"]);
});
