/**
 * Tests for the apply_stack_rekey client wrapper and its batch planner.
 *
 * The single-row decision-making this family of atomic functions relies on
 * (decideStacking/decideReprint) is already covered by stacking.test.ts and
 * reprint.test.ts. This file covers:
 *
 * - applyStackRekey: that it shapes the RPC call correctly (a fresh,
 *   well-formed operation id, the steps forwarded verbatim) and maps the two
 *   response shapes (error, and success with results in step order) the way
 *   every caller in src/app/(app)/collection and src/app/(app)/decks relies on.
 *
 * - planBatchRekey: the sequential merge-decision behavior itself — an
 *   earlier row's merge becoming visible to a later row sharing the same
 *   destination key — and the split/id hazard the reviewer found: a split's
 *   resulting row has no real, known id until apply_stack_rekey actually
 *   inserts it, so a later step in the same batch must never be offered it as
 *   a merge target.
 *
 * Run with: npx tsx --test scripts/rekey.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyStackRekey, planBatchRekey, type BatchRekeyRow, type StackRekeyStep } from "../src/lib/collection/rekey";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fakeSupabase(handler: (name: string, args: unknown) => { data: unknown; error: unknown }) {
  return {
    rpc: async (name: string, args: unknown) => handler(name, args),
  } as unknown as Parameters<typeof applyStackRekey>[0];
}

const steps: StackRekeyStep[] = [
  { mode: "set_quantity", source_instance_id: "row-1", quantity: 3 },
  {
    mode: "rekey",
    source_instance_id: "row-1",
    quantity: 3,
    condition: "NM",
    finish: "nonfoil",
    language: "en",
    location_id: null,
    notes: null,
    target_instance_id: "row-2",
  },
];

test("calls apply_stack_rekey with a fresh operation id and the steps verbatim", async () => {
  let seenName = "";
  let seenArgs: { p_operation_id?: string; p_steps?: unknown } = {};

  const supabase = fakeSupabase((name, args) => {
    seenName = name;
    seenArgs = args as typeof seenArgs;
    return { data: [], error: null };
  });

  await applyStackRekey(supabase, steps);

  assert.equal(seenName, "apply_stack_rekey");
  assert.match(seenArgs.p_operation_id ?? "", UUID_RE);
  assert.deepEqual(seenArgs.p_steps, steps);
});

test("two calls mint two different operation ids", async () => {
  const seen: string[] = [];
  const supabase = fakeSupabase((_name, args) => {
    seen.push((args as { p_operation_id: string }).p_operation_id);
    return { data: [], error: null };
  });

  await applyStackRekey(supabase, steps);
  await applyStackRekey(supabase, steps);

  assert.notEqual(seen[0], seen[1]);
});

test("maps a database error to { results: null, error }", async () => {
  const supabase = fakeSupabase(() => ({
    data: null,
    error: { message: "That copy is in an open trade offer -- cancel or complete the trade first" },
  }));

  const { results, error } = await applyStackRekey(supabase, steps);
  assert.equal(results, null);
  assert.equal(error, "That copy is in an open trade offer -- cancel or complete the trade first");
});

test("returns the per-step results array in order on success", async () => {
  const rows = [
    { step_index: 0, result_instance_id: "row-1", result_quantity: 3, replayed: false },
    { step_index: 1, result_instance_id: "row-2", result_quantity: 7, replayed: false },
  ];
  const supabase = fakeSupabase(() => ({ data: rows, error: null }));

  const { results, error } = await applyStackRekey(supabase, steps);
  assert.equal(error, null);
  assert.deepEqual(results, rows);
});

test("a non-array response (e.g. null data) becomes an empty results array, not a crash", async () => {
  const supabase = fakeSupabase(() => ({ data: null, error: null }));
  const { results, error } = await applyStackRekey(supabase, steps);
  assert.equal(error, null);
  assert.deepEqual(results, []);
});

// ---------------------------------------------------------------------------
// planBatchRekey
// ---------------------------------------------------------------------------

const sameTarget = () => ({ condition: "NM", finish: "nonfoil" as const, language: "en", location_id: "deck-1" });

function row(overrides: Partial<BatchRekeyRow> & { id: string; card_id: string; quantity: number }): BatchRekeyRow {
  return {
    condition: "NM",
    finish: "nonfoil",
    language: "en",
    location_id: "box-1",
    notes: null,
    ...overrides,
  };
}

test("planBatchRekey: no matching candidate anywhere decides no merge", () => {
  const rows = [row({ id: "row-1", card_id: "card-1", quantity: 4 })];
  const steps = planBatchRekey(rows, sameTarget, rows);

  assert.equal(steps.length, 1);
  assert.equal(steps[0].mode, "rekey");
  assert.equal((steps[0] as { target_instance_id: string | null }).target_instance_id, null);
});

test("planBatchRekey: merges into a pre-existing row already sitting at the destination key", () => {
  const rows = [row({ id: "row-1", card_id: "card-1", location_id: "box-1", quantity: 4 })];
  const existing = [
    ...rows,
    row({ id: "row-existing", card_id: "card-1", location_id: "deck-1", quantity: 2 }),
  ];

  const steps = planBatchRekey(rows, sameTarget, existing);

  assert.equal((steps[0] as { target_instance_id: string | null }).target_instance_id, "row-existing");
});

test("planBatchRekey: a whole-stack move with no existing target becomes a valid candidate for a later step in the same batch", () => {
  // Sequential visibility: two rows in the same batch land on the same new
  // key with nothing there beforehand — the first row's result (still its
  // own id, since a whole-stack "no merge" decision is the RPC's in-place
  // UPDATE branch, which keeps the row's id) must be offered to the second.
  const rows = [
    row({ id: "row-a", card_id: "card-1", location_id: "box-a", quantity: 5 }),
    row({ id: "row-b", card_id: "card-1", location_id: "box-b", quantity: 5 }),
  ];
  const existing = rows; // both rows moving their whole pile: pre-batch quantity === step quantity

  const steps = planBatchRekey(rows, sameTarget, existing) as { target_instance_id: string | null }[];

  assert.equal(steps[0].target_instance_id, null, "first row: nothing to merge into yet");
  assert.equal(steps[1].target_instance_id, "row-a", "second row: merges into the first row's own (real) id");
});

test("planBatchRekey: a split's resulting row is never offered as a merge target to a later step in the same batch", () => {
  // The bug the reviewer found: row-a only takes 3 of its 5-copy pile, which
  // is a SPLIT at the RPC (migration 41) — apply_stack_rekey inserts a BRAND
  // NEW row with a server-generated id at the destination key, and row-a's
  // own id keeps pointing at the leftover 2 copies at the OLD key. row-b then
  // takes its whole 5-copy pile to the same destination key. Before the fix,
  // planBatchRekey would offer row-a's id as a merge target for row-b, and
  // apply_stack_rekey's destination re-verification (which matches by id AND
  // key, not by key alone) would fail with no_data_found because no row with
  // id "row-a" exists at the destination key — it never left the old one.
  const preBatch = [
    row({ id: "row-a", card_id: "card-1", location_id: "box-a", quantity: 5 }),
    row({ id: "row-b", card_id: "card-1", location_id: "box-b", quantity: 5 }),
  ];
  const rows = [
    row({ id: "row-a", card_id: "card-1", location_id: "box-a", quantity: 3 }), // split: 3 of 5
    row({ id: "row-b", card_id: "card-1", location_id: "box-b", quantity: 5 }), // whole stack
  ];

  const steps = planBatchRekey(rows, sameTarget, preBatch) as { target_instance_id: string | null }[];

  assert.equal(steps[0].target_instance_id, null, "row-a: nothing to merge into yet");
  assert.equal(
    steps[1].target_instance_id,
    null,
    "row-b must NOT merge into row-a's phantom id -- it decides fresh, exactly as the RPC would",
  );
});
