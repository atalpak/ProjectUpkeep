/**
 * The command palette / shortcut catalogue (src/lib/playtest/palette.ts) and
 * the deck fingerprint text (board/fingerprint.ts). The palette is what makes
 * every action discoverable without the mouse, so the tests pin the phrases
 * the owner named ("draw 3", "search library", "add +1/+1 counter") and the
 * invariant that every shortcut resolves to a real action.
 *
 * Run with: npx tsx --test scripts/playtest-palette.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { PALETTE_ACTIONS, matchPalette, resolveShortcut, type KeyPress } from "../src/lib/playtest/palette";
import { FINGERPRINT_VERSION, fingerprintText, isFingerprint } from "../src/lib/playtest/board/fingerprint";

const press = (key: string, over: Partial<KeyPress> = {}): KeyPress => ({ key, ctrl: false, meta: false, shift: false, alt: false, ...over });

test("'draw 3' becomes a draw of three, and 'draw 1' reads in the singular", () => {
  const [top] = matchPalette("draw 3");
  assert.deepEqual([top.id, top.arg], ["draw-n", 3]);
  assert.equal(top.label, "Draw 3 cards");
  assert.equal(matchPalette("draw 1")[0].label, "Draw 1 card");
});

test("'search library' finds the library search; 'tutor' does too", () => {
  assert.equal(matchPalette("search library")[0].id, "search-library");
  assert.ok(matchPalette("tutor").some((m) => m.id === "search-library"));
});

test("'add +1/+1 counter' carries the counter name; other names and phrasings work", () => {
  const [top] = matchPalette("add +1/+1 counter");
  assert.deepEqual([top.id, top.arg], ["add-counter", "+1/+1"]);
  assert.deepEqual([matchPalette("add loyalty counter")[0].id, matchPalette("add loyalty counter")[0].arg], ["add-counter", "loyalty"]);
  assert.equal(matchPalette("counter shield")[0].arg, "shield");
  assert.equal(matchPalette("add +1/+1")[0].arg, "+1/+1");
});

test("numeric forms: mill, peek top/bottom, turn, poison, roll, coin", () => {
  assert.deepEqual([matchPalette("mill 4")[0].id, matchPalette("mill 4")[0].arg], ["mill", 4]);
  assert.deepEqual([matchPalette("peek 5")[0].id, matchPalette("peek 5")[0].arg], ["peek-top", 5]);
  assert.deepEqual([matchPalette("look at top 2")[0].id, matchPalette("look at top 2")[0].arg], ["peek-top", 2]);
  assert.deepEqual([matchPalette("peek bottom 3")[0].id, matchPalette("peek bottom 3")[0].arg], ["peek-bottom", 3]);
  assert.deepEqual([matchPalette("turn 7")[0].id, matchPalette("turn 7")[0].arg], ["set-turn", 7]);
  assert.deepEqual([matchPalette("poison 2")[0].id, matchPalette("poison 2")[0].arg], ["tracker-poison", 2]);
  assert.deepEqual([matchPalette("roll d20")[0].id, matchPalette("roll d20")[0].arg], ["roll", "d20"]);
  assert.equal(matchPalette("flip a coin")[0].arg, "coin");
});

test("life distinguishes setting a total from changing it", () => {
  const set = matchPalette("life 30")[0];
  assert.deepEqual([set.id, set.arg, set.mode], ["life-set", 30, "set"]);
  const minus = matchPalette("life -3")[0];
  assert.deepEqual([minus.id, minus.arg, minus.mode], ["life-set", -3, "delta"]);
  assert.equal(matchPalette("life +5")[0].mode, "delta");
});

test("an empty query lists actions; nonsense finds nothing; results are capped", () => {
  assert.ok(matchPalette("").length > 5);
  assert.deepEqual(matchPalette("zzzqqq"), []);
  assert.ok(matchPalette("a", 4).length <= 4);
});

test("free text finds actions by label and by keyword", () => {
  assert.ok(matchPalette("untap").some((m) => m.id === "untap-all"));
  assert.ok(matchPalette("shuffle").some((m) => m.id === "shuffle"));
  assert.ok(matchPalette("scry").some((m) => m.id === "peek-top"));
  assert.ok(matchPalette("clone").some((m) => m.id === "copy-token"));
});

test("action ids are unique and every action has a label and group", () => {
  const ids = PALETTE_ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const action of PALETTE_ACTIONS) assert.ok(action.label.length > 3 && action.group);
});

test("every shortcut in the sheet resolves to its own action, and no two actions share a key", () => {
  const seen = new Map<string, string>();
  for (const action of PALETTE_ACTIONS.filter((a) => a.shortcut)) {
    const spec = action.shortcut!;
    if (seen.has(spec)) assert.fail(`${spec} is used by ${seen.get(spec)} and ${action.id}`);
    seen.set(spec, action.id);
  }
  const cases: Array<[KeyPress, string]> = [
    [press("d"), "draw"], [press("s"), "shuffle"], [press("f"), "search-library"], [press("n"), "next-turn"], [press("u"), "untap-all"],
    [press("t"), "tap-toggle"], [press("T", { shift: true }), "tidy"], [press("g"), "to-graveyard"], [press("e"), "to-exile"], [press("r"), "to-hand"],
    [press("l"), "to-library-top"], [press("b"), "to-library-bottom"], [press("p"), "proliferate"], [press("c"), "copy-token"], [press("k"), "create-token"],
    [press("a"), "select-all"], [press("h"), "hand-overlay"], [press("o"), "log"], [press("v"), "view-graveyard"], [press("i"), "inspect"],
    [press("+"), "add-counter"], [press("-"), "remove-counter"], [press("Delete"), "delete"], [press("Escape"), "clear-selection"], [press("?"), "keybinds"],
    [press("z", { ctrl: true }), "undo"], [press("z", { meta: true }), "undo"], [press("z", { ctrl: true, shift: true }), "redo"], [press("y", { ctrl: true }), "redo"],
    [press("g", { ctrl: true }), "group"], [press("g", { ctrl: true, shift: true }), "ungroup"], [press("s", { meta: true }), "save"],
  ];
  const known = new Set(PALETTE_ACTIONS.map((a) => a.id));
  for (const [keypress, id] of cases) {
    assert.equal(resolveShortcut(keypress), id, JSON.stringify(keypress));
    assert.ok(known.has(id), `${id} exists in the catalogue`);
  }
});

test("the palette opens on '/' and on Ctrl or Cmd K; number keys quick-play hand cards", () => {
  assert.equal(resolveShortcut(press("/")), "palette");
  assert.equal(resolveShortcut(press("k", { ctrl: true })), "palette");
  assert.equal(resolveShortcut(press("K", { meta: true })), "palette");
  assert.equal(resolveShortcut(press("3")), "play-hand-3");
  assert.equal(resolveShortcut(press("3", { shift: true })), "play-hand-tapped-3");
  assert.equal(resolveShortcut(press("0")), null);
  assert.equal(resolveShortcut(press("d", { alt: true })), null, "alt combinations are left to the browser");
  assert.equal(resolveShortcut(press("x", { ctrl: true })), null, "copy/cut are not hijacked");
  assert.equal(resolveShortcut(press("F5")), null);
});

test("fingerprint text is canonical: order and duplicate rows do not matter, contents do", () => {
  const a = fingerprintText([{ cardId: "b", quantity: 2 }, { cardId: "a", quantity: 1 }], ["cmd"]);
  const b = fingerprintText([{ cardId: "a", quantity: 1 }, { cardId: "b", quantity: 1 }, { cardId: "b", quantity: 1 }], ["cmd"]);
  assert.equal(a, b);
  assert.ok(a.startsWith(FINGERPRINT_VERSION));
  assert.notEqual(a, fingerprintText([{ cardId: "a", quantity: 2 }, { cardId: "b", quantity: 2 }], ["cmd"]));
  assert.notEqual(a, fingerprintText([{ cardId: "b", quantity: 2 }, { cardId: "a", quantity: 1 }], []));
  assert.notEqual(fingerprintText([], ["x", "y"]), fingerprintText([], ["y", "z"]));
  assert.equal(fingerprintText([], ["y", "x"]), fingerprintText([], ["x", "y"]), "partner order does not matter");
});

test("isFingerprint accepts only a 64-char lowercase hex digest", () => {
  assert.equal(isFingerprint("a".repeat(64)), true);
  for (const bad of ["A".repeat(64), "a".repeat(63), "g".repeat(64), "", null, 5]) assert.equal(isFingerprint(bad), false);
});
