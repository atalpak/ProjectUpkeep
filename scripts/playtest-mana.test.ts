/**
 * Mana cost parsing and payability.
 *
 * The hybrid/phyrexian/twobrid distinctions matter because they change what
 * "can I cast this" means, and the canPay test below is the one the brief
 * flagged as order-sensitive: a naive left-to-right assignment can fail a
 * hand that is genuinely castable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { canPay, isLand, parseCost, producedColors } from "../src/lib/playtest/mana";

test("a null cost parses to nothing owed", () => {
  assert.deepEqual(parseCost(null), { generic: 0, pips: [] });
});

test("generic and colour pips both parse", () => {
  assert.deepEqual(parseCost("{2}{W}{W}"), {
    generic: 2,
    pips: [
      { kind: "color", colors: ["W"] },
      { kind: "color", colors: ["W"] },
    ],
  });
});

test("hybrid: either colour pays it", () => {
  assert.deepEqual(parseCost("{W/U}"), { generic: 0, pips: [{ kind: "color", colors: ["W", "U"] }] });
});

test("phyrexian: payable without the colour at all", () => {
  assert.deepEqual(parseCost("{W/P}"), { generic: 0, pips: [{ kind: "phyrexian", colors: ["W"] }] });
});

test("twobrid: the colour, or 2 generic", () => {
  assert.deepEqual(parseCost("{2/W}"), { generic: 0, pips: [{ kind: "twobrid", color: "W" }] });
});

test("colourless is its own pip, not a colour", () => {
  assert.deepEqual(parseCost("{C}"), { generic: 0, pips: [{ kind: "colorless" }] });
});

test("{X} counts as 0 and contributes no pip", () => {
  assert.deepEqual(parseCost("{X}{R}"), { generic: 0, pips: [{ kind: "color", colors: ["R"] }] });
});

// ---------------------------------------------------------------------------
// producedColors / isLand
// ---------------------------------------------------------------------------

test("produced_mana is authoritative when present", () => {
  assert.deepEqual(producedColors({ produced_mana: ["U", "B"], type_line: "Land" }), ["U", "B"]);
});

test("produced_mana drops anything outside WUBRG (e.g. colourless C)", () => {
  assert.deepEqual(producedColors({ produced_mana: ["C"], type_line: "Land" }), []);
});

test("no produced_mana falls back to basic land types in the type line", () => {
  assert.deepEqual(producedColors({ produced_mana: null, type_line: "Basic Land - Island" }), ["U"]);
});

test("a nonland with no production is empty, not a guess", () => {
  assert.deepEqual(producedColors({ produced_mana: null, type_line: "Creature - Bear" }), []);
});

test("a dual's basic types both come through the fallback", () => {
  const colors = producedColors({ produced_mana: null, type_line: "Land - Island Swamp" });
  assert.deepEqual([...colors].sort(), ["B", "U"]);
});

test("isLand reads the front face of a split type line", () => {
  assert.equal(isLand("Land // Creature — Elemental"), true);
  assert.equal(isLand("Instant // Land"), false);
  assert.equal(isLand("Creature — Bear"), false);
  assert.equal(isLand(null), false);
});

// ---------------------------------------------------------------------------
// canPay
// ---------------------------------------------------------------------------

test("a plain cost is paid by matching colours plus enough generic", () => {
  const cost = parseCost("{1}{G}{G}");
  assert.equal(canPay(cost, [["G"], ["G"], ["R"]]), true);
  assert.equal(canPay(cost, [["G"], ["R"], ["R"]]), false);
});

test("hybrid pays from either listed colour", () => {
  const cost = parseCost("{W/U}");
  assert.equal(canPay(cost, [["U"]]), true);
  assert.equal(canPay(cost, [["B"]]), false);
});

test("phyrexian is always payable and spends no source", () => {
  const cost = parseCost("{W/P}{W/P}");
  assert.equal(canPay(cost, []), true);
});

test("twobrid pays with the colour when available", () => {
  const cost = parseCost("{2/W}");
  assert.equal(canPay(cost, [["W"]]), true);
});

test("twobrid falls back to 2 generic when its colour is missing", () => {
  const cost = parseCost("{2/W}");
  assert.equal(canPay(cost, [["R"], ["R"]]), true);
  assert.equal(canPay(cost, [["R"]]), false);
});

test("colourless folds into the generic total", () => {
  const cost = parseCost("{C}{C}");
  assert.equal(canPay(cost, [["W"], ["U"]]), true);
  assert.equal(canPay(cost, [["W"]]), false);
});

test("the hard case: {W}{U}{B} from three duals, only one of which makes black", () => {
  const cost = parseCost("{W}{U}{B}");
  // Listed with the black-capable dual first and both its colours shared with
  // the other two duals, so a naive left-to-right assignment (claim the first
  // matching source for {W}, then for {U}, only then look at {B}) burns the
  // only black source on the {U} pip and fails. The most-constrained-first
  // greedy must lock the unique {B} source to {B} before either flexible pip
  // gets a turn.
  const sources: Array<Array<"W" | "U" | "B">> = [
    ["U", "B"],
    ["W", "U"],
    ["W", "U"],
  ];
  assert.equal(canPay(cost, sources), true);
});

test("the same hard case genuinely fails without a black source anywhere", () => {
  const cost = parseCost("{W}{U}{B}");
  const sources: Array<Array<"W" | "U">> = [
    ["W", "U"],
    ["W", "U"],
    ["W", "U"],
  ];
  assert.equal(canPay(cost, sources), false);
});

test("no sources at all cannot pay a nonzero cost", () => {
  assert.equal(canPay(parseCost("{1}"), []), false);
});

test("a zero cost is always payable", () => {
  assert.equal(canPay(parseCost(null), []), true);
});
