import assert from "node:assert/strict";
import { test } from "node:test";

import { summariseBreakdown, type BreakdownRow } from "../src/lib/collection/breakdown";

const row = (over: Partial<BreakdownRow["cards"]> & { quantity?: number } = {}): BreakdownRow => ({
  quantity: over.quantity ?? 1,
  cards: {
    colors: over.colors ?? [],
    set_code: over.set_code ?? "xxx",
    set_name: over.set_name ?? "Test Set",
  },
});

test("buckets by colour: mono, gold, colourless", () => {
  const { colours } = summariseBreakdown([
    row({ colors: ["R"], quantity: 3 }),
    row({ colors: ["R"], quantity: 2 }),
    row({ colors: ["W", "U"], quantity: 4 }),
    row({ colors: [], quantity: 5 }),
  ]);

  const by = Object.fromEntries(colours.map((c) => [c.bucket, c.count]));
  assert.equal(by.R, 5, "two red stacks summed by quantity");
  assert.equal(by.M, 4, "two-colour card is multicolour");
  assert.equal(by.C, 5, "no colours is colourless");
  assert.equal(by.W, undefined, "empty buckets are dropped");
});

test("colours come back in WUBRG-M-C order", () => {
  const { colours } = summariseBreakdown([
    row({ colors: [] }),
    row({ colors: ["G"] }),
    row({ colors: ["W"] }),
    row({ colors: ["B", "R"] }),
  ]);
  assert.deepEqual(
    colours.map((c) => c.bucket),
    ["W", "G", "M", "C"].sort(
      (a, b) => ["W", "U", "B", "R", "G", "M", "C"].indexOf(a) - ["W", "U", "B", "R", "G", "M", "C"].indexOf(b),
    ),
  );
});

test("sets are counted by quantity and ordered most-first", () => {
  const { sets } = summariseBreakdown([
    row({ set_code: "one", set_name: "Set One", quantity: 2 }),
    row({ set_code: "two", set_name: "Set Two", quantity: 9 }),
    row({ set_code: "one", set_name: "Set One", quantity: 3 }),
  ]);
  assert.deepEqual(sets, [
    { code: "two", name: "Set Two", count: 9 },
    { code: "one", name: "Set One", count: 5 },
  ]);
});

test("a row with no set is left out of the set breakdown but still counts for colour", () => {
  const { sets, colours } = summariseBreakdown([
    { quantity: 4, cards: { colors: ["U"], set_code: null, set_name: null } },
  ]);
  assert.equal(sets.length, 0);
  assert.equal(colours.find((c) => c.bucket === "U")?.count, 4);
});
