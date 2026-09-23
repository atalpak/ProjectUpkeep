import type { createClient } from "@/lib/supabase/server";
import { decideStacking, type StackableRow } from "@/lib/collection/stacking";

/**
 * The client-side half of `apply_stack_rekey` (migration 41).
 *
 * Every server action that edits, moves, merges or re-files an owned stack —
 * `updateCardInstance`, `bulkMove`, `bulkSetField`, `bulkMerge`, sleeve/unsleeve
 * and remove-from-deck (`src/app/(app)/collection/*`, `src/app/(app)/decks/actions.ts`)
 * — builds a list of these steps and makes one call, rather than each doing its
 * own read-decide-write. See the migration's header for why: those seven paths
 * used to be four separate places a stale read or a partial multi-request write
 * could duplicate a row, silently drop copies, or (unsleeveCopies,
 * removeEntryFromList) swallow the write error outright.
 *
 * A rekey step's condition/finish/language/location_id/notes are always the
 * FULL post-rekey stack key and notes value, matching every sibling atomic
 * function in this family (apply_stack_addition/move/reprint) — never a
 * partial patch.
 */
export type SetQuantityStep = {
  mode: "set_quantity";
  source_instance_id: string;
  quantity: number;
};

export type RekeyStep = {
  mode: "rekey";
  source_instance_id: string;
  quantity: number;
  condition: string;
  finish: string;
  language: string;
  location_id: string | null;
  notes: string | null;
  target_instance_id: string | null;
};

export type StackRekeyStep = SetQuantityStep | RekeyStep;

export type StackRekeyResult = {
  step_index: number;
  result_instance_id: string;
  result_quantity: number;
  replayed: boolean;
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Calls `apply_stack_rekey` with a fresh operation id (this call's idempotency
 * key, the same role it plays on every sibling in this family) and the given
 * ordered steps. Returns the per-step results in the same order the steps were
 * submitted.
 */
/** The minimum shape planBatchRekey needs off a row it might move or match against. */
export type BatchRekeyRow = {
  id: string;
  card_id: string;
  condition: string;
  finish: string;
  language: string;
  location_id: string | null;
  notes: string | null;
  quantity: number;
};

export type RekeyTarget = {
  condition: string;
  finish: string;
  language: string;
  location_id: string | null;
};

function groupKey(cardId: string, target: RekeyTarget): string {
  return [cardId, target.condition, target.finish, target.language, target.location_id ?? "~unsorted"].join("|");
}

/**
 * Decides a merge target (or none) for every row in an ordered batch that is
 * moving to a possibly different key — the shared decision behind bulkMove,
 * bulkSetField and sleeving many cards at once, all of which used to update
 * rows directly with no merge step at all (the "missing-merge bug" the
 * architect's impact map found in three places, apps/mobile/docs/BACKLOG.md
 * item 2).
 *
 * Applies decideStacking's single-row rule sequentially: a merge decided for
 * an earlier row in this same batch is visible to a later row sharing the
 * same destination key, exactly as if each were its own
 * apply_stack_addition call landing on the previous one's result. Pure and
 * synchronous — it does no I/O and never re-reads anything between rows.
 *
 * `existingRows` should be read once, before the loop: every one of the
 * caller's own card_instances rows sharing a card_id with something in this
 * batch, at ANY location. A row only ever contributes as a merge candidate
 * for a destination key that happens to already match where it sits, so
 * passing the caller's whole relevant collection here is always safe, not
 * just convenient — it lets one call site's shape (bulkMove changes
 * location, bulkSetField changes one field, sleeving changes location into a
 * deck) share this one function.
 */
export function planBatchRekey(
  rows: BatchRekeyRow[],
  targetFor: (row: BatchRekeyRow) => RekeyTarget,
  existingRows: BatchRekeyRow[],
): RekeyStep[] {
  const byKey = new Map<string, StackableRow[]>();
  for (const row of existingRows) {
    const key = groupKey(row.card_id, row);
    const list = byKey.get(key) ?? [];
    list.push({ id: row.id, quantity: row.quantity, notes: row.notes });
    byKey.set(key, list);
  }

  // Each row's quantity as it stood before this batch touches it, read off
  // existingRows (the caller's pre-batch snapshot) rather than off `rows`
  // itself — `rows[i].quantity` is the amount THIS step is moving, which for
  // sleeveCopies/unsleeveCopies can be less than the row's actual pile, and
  // sameness against the pre-batch amount is exactly what tells a whole-stack
  // move apart from a split. See the "no merge" branch below for why that
  // distinction is load-bearing.
  const originalQuantityById = new Map<string, number>();
  for (const row of existingRows) originalQuantityById.set(row.id, row.quantity);

  const steps: RekeyStep[] = [];

  for (const row of rows) {
    const target = targetFor(row);
    const key = groupKey(row.card_id, target);
    const candidates = (byKey.get(key) ?? []).filter((c) => c.id !== row.id);

    const decision = decideStacking(
      {
        card_id: row.card_id,
        condition: target.condition,
        finish: target.finish,
        language: target.language,
        location_id: target.location_id,
        notes: row.notes,
        quantity: row.quantity,
      } as Parameters<typeof decideStacking>[0],
      candidates,
    );

    steps.push({
      mode: "rekey",
      source_instance_id: row.id,
      quantity: row.quantity,
      condition: target.condition,
      finish: target.finish,
      language: target.language,
      location_id: target.location_id,
      notes: row.notes,
      target_instance_id: decision.action === "merge" ? decision.instanceId : null,
    });

    const list = byKey.get(key) ?? [];
    if (decision.action === "merge") {
      const idx = list.findIndex((c) => c.id === decision.instanceId);
      if (idx >= 0) list[idx] = { ...list[idx], quantity: decision.newQuantity };
    } else {
      // "No merge" at the RPC covers two different branches, and only one of
      // them leaves a row this function can safely offer to a later step in
      // the same batch. Whole-stack ("in-place") rekeys UPDATE the source row
      // and keep its id, so row.id is real and stays a valid merge target.
      // A SPLIT (row.quantity here is less than the row's pre-batch total, so
      // some quantity is left behind at the OLD key) instead INSERTs a brand
      // new row at the new key with a server-generated id apply_stack_rekey
      // does not hand back to the planner — row.id still names the old row
      // sitting at the old key. Offering it here as a candidate at the NEW
      // key would hand a later step a target_instance_id that does not exist
      // there yet, and the RPC's destination re-verification (which matches
      // by id AND key together, not by key alone -- see migration 41's merge
      // branch) would then raise no_data_found and fail the whole batch. So a
      // split's row is simply left out of the candidate pool: a later step
      // that would have merged into it instead makes its own decision against
      // nothing, i.e. another split or a fresh row, exactly like the RPC
      // would if asked to insert twice at the same key. (Matching by key
      // alone instead of id was considered and rejected for this reason --
      // the RPC does not support it, and duplicating its id+key check here
      // client-side would just be a second, harder-to-keep-in-sync copy of
      // the same rule.)
      const original = originalQuantityById.get(row.id) ?? row.quantity;
      const isWholeStack = row.quantity === original;
      if (isWholeStack) list.push({ id: row.id, quantity: row.quantity, notes: row.notes });
    }
    byKey.set(key, list);
  }

  return steps;
}

export async function applyStackRekey(
  supabase: SupabaseClient,
  steps: StackRekeyStep[],
): Promise<{ results: StackRekeyResult[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc("apply_stack_rekey", {
    p_operation_id: crypto.randomUUID(),
    p_steps: steps,
  });

  if (error) return { results: null, error: error.message };

  const results = (Array.isArray(data) ? data : []) as StackRekeyResult[];
  return { results, error: null };
}
