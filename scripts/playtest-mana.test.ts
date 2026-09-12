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

import {
  canPay,
  COLORS,
  isLand,
  parseCost,
  producedColors,
  type Color,
  type ParsedCost,
  type Pip,
} from "../src/lib/playtest/mana";
import { mulberry32, type RNG } from "../src/lib/playtest/rng";

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
  // only black source on the {U} pip and fails. The matching in `canPay` has
  // to find the augmenting path that reassigns {U} to a WU dual, freeing the
  // UB dual for {B}.
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

// ---------------------------------------------------------------------------
// canPay — twobrid-vs-generic regressions
//
// The greedy this replaced spent a real colour source on a twobrid pip
// whenever one matched, without weighing whether that source was the *only*
// thing that could pay some other, less flexible pip. Both cases below are
// genuinely payable and both came back `false` under the greedy.
// ---------------------------------------------------------------------------

test("repro: {2/U}{U/R}{2/U} from Island, Island, Swamp, Plains — a twobrid can be paid as generic to spare a source for the hybrid", () => {
  // Island pays {U/R}; the other Island pays one {2/U} for its colour;
  // Swamp + Plains pay the second {2/U} as 2 generic.
  const cost = parseCost("{2/U}{U/R}{2/U}");
  const sources: Color[][] = [["U"], ["U"], ["B"], ["W"]];
  assert.equal(canPay(cost, sources), true);
});

test("repro: {2/W}{W} from Plains, Swamp, Swamp — an ordinary board, not a contrived one", () => {
  // Plains pays {W}; the two Swamps pay {2/W} as 2 generic.
  const cost = parseCost("{2/W}{W}");
  const sources: Color[][] = [["W"], ["B"], ["B"]];
  assert.equal(canPay(cost, sources), true);
});

// ---------------------------------------------------------------------------
// canPay — brute-force differential test
//
// `referenceCanPay` below is a second, independent implementation: plain
// backtracking over every way to assign sources to pips (including, for each
// twobrid pip, the choice between spending a source and paying 2 generic),
// rather than `canPay`'s bipartite matching. It shares no code with
// `src/lib/playtest/mana.ts`, so it can't share its bugs either. A 200,000-
// trial fuzz during review found 233 mismatches in this exact shape (a
// twobrid pip resolved the wrong way); this is what keeps that from coming
// back unnoticed. Trial count is kept low enough to stay fast in `npm test` —
// a few thousand is plenty to catch a systematic error, and the seed is fixed
// so a failure reproduces.
// ---------------------------------------------------------------------------

type ReferencePip = { colors: Color[]; twobrid: boolean };

function referenceCanPay(cost: ParsedCost, sources: Color[][]): boolean {
  let generic = cost.generic;
  const demanding: ReferencePip[] = [];

  for (const pip of cost.pips) {
    if (pip.kind === "phyrexian") continue; // 2 life is always an option
    if (pip.kind === "colorless") {
      generic += 1;
      continue;
    }
    if (pip.kind === "twobrid") {
      demanding.push({ colors: [pip.color], twobrid: true });
      continue;
    }
    demanding.push({ colors: pip.colors, twobrid: false });
  }

  const used = sources.map(() => false);

  // Exhaustively tries, in turn, every unused source that could pay pip `i`
  // (and, for a twobrid pip, the "pay as generic instead" branch), rather
  // than committing to one choice — the thing the greedy this replaced never
  // did.
  function search(i: number, genericFromTwobrids: number): boolean {
    if (i === demanding.length) {
      const sourcesLeft = used.filter((u) => !u).length;
      return sourcesLeft >= generic + genericFromTwobrids;
    }

    const pip = demanding[i];
    for (let s = 0; s < sources.length; s++) {
      if (used[s]) continue;
      if (!sources[s].some((c) => pip.colors.includes(c))) continue;
      used[s] = true;
      if (search(i + 1, genericFromTwobrids)) {
        used[s] = false;
        return true;
      }
      used[s] = false;
    }

    if (pip.twobrid && search(i + 1, genericFromTwobrids + 2)) return true;
    return false;
  }

  return search(0, 0);
}

function randomColor(rng: RNG): Color {
  return COLORS[Math.floor(rng() * COLORS.length)];
}

function randomPip(rng: RNG): Pip {
  const roll = rng();
  if (roll < 0.15) return { kind: "phyrexian", colors: [randomColor(rng)] };
  if (roll < 0.3) return { kind: "colorless" };
  if (roll < 0.5) return { kind: "twobrid", color: randomColor(rng) };
  if (roll < 0.65) {
    const a = randomColor(rng);
    let b = randomColor(rng);
    while (b === a) b = randomColor(rng);
    return { kind: "color", colors: [a, b] };
  }
  return { kind: "color", colors: [randomColor(rng)] };
}

function randomCost(rng: RNG): ParsedCost {
  const pipCount = Math.floor(rng() * 5); // 0..4 pips — real costs rarely carry more
  const pips: Pip[] = [];
  for (let i = 0; i < pipCount; i++) pips.push(randomPip(rng));
  return { generic: Math.floor(rng() * 4), pips };// 0..3 generic
}

function randomSources(rng: RNG): Color[][] {
  const count = Math.floor(rng() * 7); // 0..6 untapped sources
  const sources: Color[][] = [];
  for (let i = 0; i < count; i++) {
    const colorCount = rng() < 0.7 ? 1 : 2;
    const colors = new Set<Color>();
    while (colors.size < colorCount) colors.add(randomColor(rng));
    sources.push([...colors]);
  }
  return sources;
}

test("brute-force differential: canPay agrees with an independent exhaustive matcher", () => {
  const rng = mulberry32(20260912);
  const trials = 4000;
  const mismatches: string[] = [];

  for (let i = 0; i < trials; i++) {
    const cost = randomCost(rng);
    const sources = randomSources(rng);
    const expected = referenceCanPay(cost, sources);
    const actual = canPay(cost, sources);
    if (actual !== expected) {
      mismatches.push(`cost=${JSON.stringify(cost)} sources=${JSON.stringify(sources)} expected=${expected} got=${actual}`);
    }
  }

  assert.equal(
    mismatches.length,
    0,
    `${mismatches.length}/${trials} mismatches, first: ${mismatches[0]}`,
  );
});
