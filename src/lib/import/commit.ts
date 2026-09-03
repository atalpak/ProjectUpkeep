import "server-only";

import { createClient } from "@/lib/supabase/server";
import { decideStacking } from "@/lib/collection/stacking";
import type { PlannedStack } from "@/lib/import/plan";

/**
 * Writes a planned import.
 *
 * The add form does one stack lookup per card, which is right for one card and
 * wrong for nine hundred. Here the existing rows that could possibly merge are
 * fetched once, up front, and the same stacking policy is then applied in
 * memory — so an import is a handful of queries regardless of its size.
 *
 * Not a transaction. Supabase's REST interface has no way to open one across
 * several statements, so a failure part-way leaves the earlier writes in place.
 * That is survivable precisely because the operation is additive and stacking
 * is idempotent-ish by quantity: re-running the same file after a failure
 * double-counts, so the caller reports what landed rather than pretending it is
 * all-or-nothing. The preview warns when a run is entirely merges (see
 * projectImport) precisely because that is what re-importing your own export
 * looks like.
 */

export type CommitResult = {
  /** Physical cards written. */
  cards: number;
  /** New card_instances rows created. */
  inserted: number;
  /** Existing stacks whose quantity went up. */
  merged: number;
  /** Set when the write stopped early; earlier writes stand. */
  error: string | null;
};

type ExistingRow = {
  id: string;
  card_id: string;
  condition: string;
  finish: string;
  language: string;
  location_id: string | null;
  quantity: number;
  notes: string | null;
};

const INSERT_CHUNK = 500;
const UPDATE_CONCURRENCY = 8;

const keyOf = (r: {
  card_id: string;
  condition: string;
  finish: string;
  language: string;
  location_id: string | null;
}) => [r.card_id, r.condition, r.finish, r.language, r.location_id ?? "~unsorted"].join(" ");

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Reads the existing card_instances that an import's stacks could merge into.
 *
 * Every stack in one import shares a destination, so the rows that could merge
 * are exactly those for these cards at that location. Grouped by stack key so
 * both the projection and the commit can look a stack up in O(1).
 */
async function readExistingByKey(
  stacks: PlannedStack[],
): Promise<{ byKey: Map<string, ExistingRow[]>; error: string | null }> {
  const byKey = new Map<string, ExistingRow[]>();
  if (stacks.length === 0) return { byKey, error: null };

  const supabase = await createClient();
  const cardIds = [...new Set(stacks.map((s) => s.card_id))];
  const locationId = stacks[0].location_id;

  for (const group of chunk(cardIds, 100)) {
    const query = supabase
      .from("card_instances")
      .select("id, card_id, condition, finish, language, location_id, quantity, notes")
      .in("card_id", group);

    // `is null` and `= x` are different operators, and unsorted is a real value.
    const { data, error } =
      locationId === null
        ? await query.is("location_id", null)
        : await query.eq("location_id", locationId);

    if (error) return { byKey, error: `Could not read existing cards: ${error.message}` };

    for (const raw of (data ?? []) as ExistingRow[]) {
      const key = keyOf(raw);
      const list = byKey.get(key);
      if (list) list.push(raw);
      else byKey.set(key, [raw]);
    }
  }

  return { byKey, error: null };
}

export type ImportProjection = {
  /** Stacks that would create a new entry. */
  inserts: number;
  /** Stacks that would add quantity to an entry already in the collection. */
  merges: number;
  error: string | null;
};

/**
 * A dry run of {@link commitImport}: how many stacks land as new entries and
 * how many add to existing ones. Used by the preview so a user can be warned
 * before an all-merges run (the signature of re-importing an earlier export)
 * silently doubles their quantities.
 */
export async function projectImport(stacks: PlannedStack[]): Promise<ImportProjection> {
  const { byKey, error } = await readExistingByKey(stacks);
  if (error) return { inserts: 0, merges: 0, error };

  let inserts = 0;
  let merges = 0;
  for (const stack of stacks) {
    const decision = decideStacking(
      { ...stack, notes: null },
      byKey.get(keyOf(stack)) ?? [],
    );
    if (decision.action === "merge") merges += 1;
    else inserts += 1;
  }

  return { inserts, merges, error: null };
}

export async function commitImport(
  stacks: PlannedStack[],
  ownerUserId: string,
): Promise<CommitResult> {
  const result: CommitResult = { cards: 0, inserted: 0, merged: 0, error: null };
  if (stacks.length === 0) return result;

  const { byKey: existingByKey, error: readError } = await readExistingByKey(stacks);
  if (readError) return { ...result, error: readError };

  const supabase = await createClient();
  const toInsert: Array<Record<string, unknown>> = [];
  const toUpdate: Array<{ id: string; quantity: number }> = [];

  for (const stack of stacks) {
    const candidates = existingByKey.get(keyOf(stack)) ?? [];
    const decision = decideStacking(
      {
        card_id: stack.card_id,
        condition: stack.condition,
        finish: stack.finish,
        language: stack.language,
        location_id: stack.location_id,
        notes: null,
        quantity: stack.quantity,
      },
      candidates,
    );

    if (decision.action === "merge") {
      toUpdate.push({ id: decision.instanceId, quantity: decision.newQuantity });
      // Two stacks can never target the same existing row — they would have had
      // the same key and been combined by planImport — so no bookkeeping here.
      result.merged += 1;
    } else {
      toInsert.push({
        owner_user_id: ownerUserId,
        card_id: stack.card_id,
        location_id: stack.location_id,
        condition: stack.condition,
        finish: stack.finish,
        language: stack.language,
        quantity: stack.quantity,
        notes: null,
      });
      result.inserted += 1;
    }

    result.cards += stack.quantity;
  }

  for (const group of chunk(toInsert, INSERT_CHUNK)) {
    const { error } = await supabase.from("card_instances").insert(group);
    if (error) {
      return { ...result, error: `Import stopped part-way: ${error.message}` };
    }
  }

  // Updates cannot be batched into one statement through PostgREST without an
  // upsert, and an upsert here would need every NOT NULL column just to change
  // one. A few at a time is plenty for the number of merges a real import has.
  for (const group of chunk(toUpdate, UPDATE_CONCURRENCY)) {
    const results = await Promise.all(
      group.map(({ id, quantity }) =>
        supabase.from("card_instances").update({ quantity }).eq("id", id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      return { ...result, error: `Import stopped part-way: ${failed.error.message}` };
    }
  }

  return result;
}
