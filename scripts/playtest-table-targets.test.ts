/**
 * Two small rules of the table: what a shortcut acts on, and how big a table
 * card is drawn next to a hand card.
 *
 * Run with: npx tsx --test scripts/playtest-table-targets.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { boardCardScale, handCardPx, HAND_WIDTH_REM } from "../src/components/playtester/card-size";
import { shortcutTargets } from "../src/components/playtester/targets";
import { BOARD_ASPECT, CARD_H, CARD_W, clampPos } from "../src/lib/playtest/board/layout";

test("hover a permanent and a table shortcut acts on it, not on the selection", () => {
  const t = shortcutTargets({ hoveredId: "a", battlefield: ["a", "b"], hand: ["h"], selection: ["b"] });
  assert.deepEqual(t.onTable, ["a"]);
  assert.deepEqual(t.movable, ["a"]);
});

test("hover a hand card: moves take it, table actions fall back to the selection", () => {
  const t = shortcutTargets({ hoveredId: "h", battlefield: ["a", "b"], hand: ["h"], selection: ["b"] });
  assert.deepEqual(t.onTable, ["b"], "tapping a hand card means nothing");
  assert.deepEqual(t.movable, ["h"]);
});

test("nothing hovered: the selection is what a shortcut acts on", () => {
  const t = shortcutTargets({ hoveredId: null, battlefield: ["a"], hand: [], selection: ["a"] });
  assert.deepEqual(t.onTable, ["a"]);
  assert.deepEqual(t.movable, ["a"]);
});

test("a hovered card that has since left the table or hand is ignored", () => {
  // Hover a permanent, press G: it is now in the graveyard and its element is gone,
  // so no pointer-leave fired. The next shortcut must act on the selection.
  const t = shortcutTargets({ hoveredId: "gone", battlefield: [], hand: [], selection: ["a"] });
  assert.deepEqual(t.movable, ["a"]);
  assert.deepEqual(t.onTable, ["a"]);
});

test("a table card is drawn at the hand card's pixel width when the board is big enough", () => {
  const hand = handCardPx("medium", 900); // 6.6rem = 105.6px, under the 16% cap of 144px
  assert.equal(hand, HAND_WIDTH_REM.medium * 16);
  const boardWidth = 1200;
  const scale = boardCardScale(hand, 1, boardWidth, CARD_W);
  assert.ok(scale > 0 && scale <= 1);
  assert.ok(Math.abs(CARD_W * boardWidth * scale - hand) < 0.001, "same width in pixels");
});

test("a table card is never drawn larger than its layout size", () => {
  assert.equal(boardCardScale(400, 1.25, 300, CARD_W), 1);
});

test("a short window caps the hand card", () => {
  assert.equal(handCardPx("large", 450), 450 * 0.16);
  assert.equal(handCardPx("large", 0), HAND_WIDTH_REM.large * 16, "0 means not measured yet");
});

test("the board is wide and a card still fits it", () => {
  assert.ok(BOARD_ASPECT >= 2);
  assert.ok(CARD_H < 0.5, "at least two rows of cards fit");
  const p = clampPos({ x: 5, y: 5 });
  assert.ok(p.x + CARD_W <= 1.0001 && p.y + CARD_H <= 1.0001);
});
