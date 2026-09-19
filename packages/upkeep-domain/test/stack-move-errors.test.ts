/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isStaleDestinationTargetError, isStaleSourceError } from "../src/stack-move-errors";

// Verbatim from supabase/migrations/00000000000038_atomic_stack_move.sql.
const SOURCE =
  "That source copy no longer matches what was decided -- it may have moved, been edited, changed quantity, or no longer be yours";
const DESTINATION =
  "That destination stack no longer matches the decided target -- it may have moved, been edited, or no longer be yours";

test("the source refusal is recognised as a stale source, and only that", () => {
  assert.equal(isStaleSourceError(new Error(SOURCE)), true);
  assert.equal(isStaleDestinationTargetError(new Error(SOURCE)), false);
});

test("the destination refusal is recognised as a stale target, and only that", () => {
  assert.equal(isStaleDestinationTargetError(new Error(DESTINATION)), true);
  assert.equal(isStaleSourceError(new Error(DESTINATION)), false);
});

test("a PostgREST-shaped { message } object and a bare string both match", () => {
  assert.equal(isStaleSourceError({ message: SOURCE, code: "P0002" }), true);
  assert.equal(isStaleDestinationTargetError({ message: DESTINATION }), true);
  assert.equal(isStaleSourceError(SOURCE), true);
  assert.equal(isStaleDestinationTargetError(DESTINATION), true);
});

test("unrelated failures match neither", () => {
  for (const other of [
    new Error("duplicate key value violates unique constraint"),
    { message: "That destination stack could not be updated -- it may no longer be yours" },
    "This operation id is already in use",
    null,
    undefined,
    42,
  ]) {
    assert.equal(isStaleSourceError(other), false);
    assert.equal(isStaleDestinationTargetError(other), false);
  }
});
