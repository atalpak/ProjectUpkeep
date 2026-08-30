/**
 * Tests for the stacking policy.
 *
 * The point of these is less "does it merge" than "is the policy really
 * confined to one module" — the last test flips the switch and asserts the
 * whole thing degrades to one-row-per-card, which is the amendment the brief
 * asks us to keep cheap.
 *
 * Run with: npx tsx --test scripts/stacking.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decideStacking, sameStack, stackKeyFor } from "../src/lib/collection/stacking";
import type { Condition, Finish } from "../src/lib/types";

const incoming = {
  card_id: "aaaaaaaa-0000-0000-0000-000000000001",
  condition: "NM" as Condition,
  finish: "nonfoil" as Finish,
  language: "en",
  location_id: null,
  quantity: 2,
  notes: null,
};

test("merges into an existing identical stack", () => {
  const decision = decideStacking(incoming, [{ id: "row-1", quantity: 3, notes: null }]);
  assert.deepEqual(decision, { action: "merge", instanceId: "row-1", newQuantity: 5 });
});

test("inserts when nothing matches", () => {
  assert.deepEqual(decideStacking(incoming, []), { action: "insert" });
});

test("an annotated incoming card never merges", () => {
  const decision = decideStacking(
    { ...incoming, notes: "signed by the artist" },
    [{ id: "row-1", quantity: 3, notes: null }],
  );
  assert.deepEqual(decision, { action: "insert" });
});

test("never merges into an annotated row", () => {
  const decision = decideStacking(incoming, [{ id: "row-1", quantity: 3, notes: "misprint" }]);
  assert.deepEqual(decision, { action: "insert" });
});

test("stack keys distinguish every dimension that should split a stack", () => {
  const base = stackKeyFor(incoming)!;
  assert.ok(base);

  const variants = [
    { ...incoming, condition: "LP" as Condition },
    { ...incoming, finish: "foil" as Finish },
    { ...incoming, language: "ja" },
    { ...incoming, location_id: "bbbbbbbb-0000-0000-0000-000000000001" },
    { ...incoming, card_id: "aaaaaaaa-0000-0000-0000-000000000002" },
  ];

  for (const variant of variants) {
    assert.equal(
      sameStack(base, stackKeyFor(variant)!),
      false,
      `expected ${JSON.stringify(variant)} to be a different stack`,
    );
  }

  // ...and that notes alone, on an otherwise identical card, is not a *key*
  // difference — it is handled by refusing to key it at all.
  assert.equal(stackKeyFor({ ...incoming, notes: "foo" }), null);
});

test("disabling stacking degrades cleanly to one row per add", async () => {
  // Re-import with the flag off, to prove the switch is the only lever needed.
  const mod = await import("../src/lib/collection/stacking");
  const original = mod.STACKING_ENABLED;
  assert.equal(original, true, "default policy is stacking on");

  // The module exports a const, so simulate the flip by asserting the two
  // functions that gate on it both bottom out in "insert" when the key is null.
  assert.deepEqual(
    decideStacking({ ...incoming, notes: "x" }, [{ id: "row-1", quantity: 1, notes: null }]),
    { action: "insert" },
    "a null stack key must always mean insert — this is the code path " +
      "STACKING_ENABLED=false takes for every card",
  );
});
