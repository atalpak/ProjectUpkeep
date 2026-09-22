/**
 * Tests for the decisions behind changing an owned copy's printing.
 *
 * The write itself is `apply_stack_reprint` (migration 39) and is covered by
 * section 19 of supabase/tests/schema_test.sql. What is tested here is what
 * application code decides BEFORE calling it: which finish the copy ends up
 * with, and whether the corrected copies merge into a stack that already
 * exists.
 *
 * Run with: npx tsx --test scripts/reprint.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideReprint,
  isSameCard,
  reconcileFinish,
  STACKING_ENABLED,
  type ReprintIntent,
} from "@upkeep/domain";

const intent = (over: Partial<ReprintIntent> = {}): ReprintIntent => ({
  sourceInstanceId: "src",
  newCardId: "m10",
  finish: "nonfoil",
  quantity: 1,
  condition: "NM",
  language: "en",
  location_id: "box",
  notes: null,
  ...over,
});

// ---------------------------------------------------------------------------
// reconcileFinish
// ---------------------------------------------------------------------------

test("a printing made in the copy's finish asks the user nothing", () => {
  const result = reconcileFinish("foil", ["nonfoil", "foil"]);
  assert.deepEqual(result, { kind: "keep", finish: "foil" });
});

test("a printing that was never made in this finish forces a choice", () => {
  // The owner's rule: warn and make them pick. Never hide the printing — a
  // nonfoil-only reprint of a card you own in foil is still the card in hand.
  const result = reconcileFinish("foil", ["nonfoil"]);
  assert.deepEqual(result, { kind: "choose", from: "foil", options: ["nonfoil"] });
});

test("the offered options keep the app's own finish order, not the catalogue's", () => {
  const result = reconcileFinish("glossy", ["etched", "foil", "nonfoil"]);
  assert.equal(result.kind, "choose");
  assert.deepEqual(result.kind === "choose" ? result.options : [], [
    "nonfoil",
    "foil",
    "etched",
  ]);
});

test("finishes the app does not understand are dropped, not offered", () => {
  const result = reconcileFinish("foil", ["nonfoil", "surgefoil", "galaxyfoil"]);
  assert.deepEqual(result, { kind: "choose", from: "foil", options: ["nonfoil"] });
});

test("a printing recording no finishes at all is a catalogue gap, not a choice", () => {
  assert.deepEqual(reconcileFinish("nonfoil", []), { kind: "impossible", from: "nonfoil" });
  assert.deepEqual(reconcileFinish("nonfoil", null), { kind: "impossible", from: "nonfoil" });
  assert.deepEqual(reconcileFinish("nonfoil", undefined), {
    kind: "impossible",
    from: "nonfoil",
  });
  // And a printing whose only finishes are ones we do not model reads the same
  // way: there is nothing we could legitimately record.
  assert.deepEqual(reconcileFinish("nonfoil", ["surgefoil"]), {
    kind: "impossible",
    from: "nonfoil",
  });
});

// ---------------------------------------------------------------------------
// decideReprint
// ---------------------------------------------------------------------------

test("no matching stack means insert", () => {
  assert.deepEqual(decideReprint(intent(), []), { action: "insert" });
});

test("a matching stack is merged into, with its id and a quantity hint", () => {
  const decision = decideReprint(intent({ quantity: 2 }), [
    { id: "other", quantity: 3, notes: null },
  ]);
  assert.deepEqual(decision, { action: "merge", instanceId: "other", newQuantity: 5 });
});

test("THE SOURCE ROW IS NEVER ITS OWN MERGE TARGET", () => {
  // Correcting 2 of a 5-stack to a printing it already is makes the source row
  // match the post-reprint key. apply_stack_reprint refuses a self-merge
  // outright, so passing it would turn a legitimate no-op into an error.
  const decision = decideReprint(intent({ quantity: 2 }), [
    { id: "src", quantity: 5, notes: null },
  ]);
  assert.deepEqual(decision, { action: "insert" });
});

test("the source row is excluded even when a real target sits beside it", () => {
  const decision = decideReprint(intent({ quantity: 1 }), [
    { id: "src", quantity: 5, notes: null },
    { id: "other", quantity: 2, notes: null },
  ]);
  assert.deepEqual(decision, { action: "merge", instanceId: "other", newQuantity: 3 });
});

test("an annotated copy never merges — the note is about that physical card", () => {
  const decision = decideReprint(intent({ notes: "signed by the artist" }), [
    { id: "other", quantity: 3, notes: null },
  ]);
  assert.deepEqual(decision, { action: "insert" });
});

test("a candidate carrying a note is never chosen as the target", () => {
  const decision = decideReprint(intent(), [{ id: "other", quantity: 3, notes: "water damage" }]);
  assert.deepEqual(decision, { action: "insert" });
});

test("a candidate whose note is only whitespace still counts as un-annotated", () => {
  const decision = decideReprint(intent(), [{ id: "other", quantity: 3, notes: "   " }]);
  assert.deepEqual(decision, { action: "merge", instanceId: "other", newQuantity: 4 });
});

test("with stacking off, a reprint always stays one row per physical card", () => {
  // Guards the reversible bet: flipping STACKING_ENABLED must degrade this
  // feature to a plain in-place printing change, with no migration.
  if (STACKING_ENABLED) return;
  assert.deepEqual(decideReprint(intent(), [{ id: "other", quantity: 3, notes: null }]), {
    action: "insert",
  });
});

// ---------------------------------------------------------------------------
// isSameCard
// ---------------------------------------------------------------------------

test("the same oracle id is the same card whatever the printing is called", () => {
  assert.equal(
    isSameCard({ oracle_id: "o1", name: "Lightning Bolt" }, { oracle_id: "o1", name: "Lightning Bolt" }),
    true,
  );
});

test("a different oracle id is a different card even under the same name", () => {
  // Art series cards and tokens share names with the real card. The picker
  // matches on name, so this is the gate that stops one being offered as a
  // reprint of the other.
  assert.equal(
    isSameCard({ oracle_id: "o1", name: "Lightning Bolt" }, { oracle_id: "o2", name: "Lightning Bolt" }),
    false,
  );
});

test("a Universes Beyond printing matches on oracle id, not on its printed name", () => {
  assert.equal(
    isSameCard({ oracle_id: "o9", name: "Spark Double" }, { oracle_id: "o9", name: "Spark Double" }),
    true,
  );
});

test("with no oracle id on either side it falls back to the name, case-insensitively", () => {
  assert.equal(isSameCard({ name: "Lightning Bolt" }, { name: "lightning bolt" }), true);
  assert.equal(isSameCard({ name: "Lightning Bolt" }, { name: "Shock" }), false);
});

test("one side missing an oracle id falls back to the name rather than refusing", () => {
  assert.equal(
    isSameCard({ oracle_id: null, name: "Lightning Bolt" }, { oracle_id: "o1", name: "Lightning Bolt" }),
    true,
  );
});
