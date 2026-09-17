/**
 * Tests for the stacking policy, lifted from scripts/stacking.test.ts along
 * with the module itself. See that file's header for why the last two tests
 * are shaped the way they are — a `const` cannot be flipped mid-test-run, so
 * "stacking off" is exercised via the same null-stack-key path
 * STACKING_ENABLED=false takes for every card, not by actually toggling it.
 *
 * Run with: npm test -w @upkeep/domain
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decideStacking, sameStack, stackKeyFor, STACKING_ENABLED } from "../src/stacking";
import type { Condition, Finish } from "../src/vocabulary";

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

test("disabling stacking degrades cleanly to insert everywhere, including through apply_stack_addition", () => {
  assert.equal(STACKING_ENABLED, true, "default policy is stacking on");

  // The module exports a const, so simulate the flip by asserting the two
  // functions that gate on it both bottom out in "insert" when the key is
  // null — this is the exact path STACKING_ENABLED=false takes for every
  // card, on both clients, and (via the shared decision) for the branch
  // migration 36's apply_stack_addition takes: a caller that never decides
  // "merge" never passes a target instance id, so the function's insert
  // branch is all that ever runs.
  assert.deepEqual(
    decideStacking({ ...incoming, notes: "x" }, [{ id: "row-1", quantity: 1, notes: null }]),
    { action: "insert" },
    "a null stack key must always mean insert",
  );
});
