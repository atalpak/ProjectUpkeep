"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { CONDITIONS, FINISHES, LANGUAGES } from "@/lib/types";
import { MAX_BULK_IDS, type BulkState } from "@/app/(app)/collection/bulk-state";
import { applyStackRekey, planBatchRekey, type BatchRekeyRow } from "@/lib/collection/rekey";

/**
 * Bulk operations over selected collection rows.
 *
 * `bulkDelete` still relies on RLS alone — an id belonging to somebody else
 * simply matches no row, and the count reported back is rows actually
 * affected. `bulkMove`, `bulkSetField` and `bulkMerge` route through
 * `apply_stack_rekey` (migration 41, src/lib/collection/rekey.ts) instead:
 * each of the three used to read-decide-write directly against
 * card_instances with no merge step at all (a duplicate-rows bug, not
 * corruption) and, in bulkMerge's case, without even the owner filter hard
 * constraint 3 requires on the read. See the migration's header and
 * apps/mobile/docs/BACKLOG.md item 2 for the fuller history.
 */

function fail(message: string): BulkState {
  return { error: message, notice: null };
}

function ok(message: string): BulkState {
  return { error: null, notice: message, nonce: crypto.randomUUID() };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Reads and sanity-checks the selected ids. */
function readIds(formData: FormData): { ok: true; ids: string[] } | { ok: false; error: string } {
  const raw = String(formData.get("ids") ?? "");
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) return { ok: false, error: "Nothing selected." };
  if (ids.length > MAX_BULK_IDS) {
    return { ok: false, error: `That is more than ${MAX_BULK_IDS} rows at once.` };
  }
  return { ok: true, ids };
}

/**
 * Supabase encodes `.in()` filters into the request URL as `id=in.(a,b,c)`.
 * At a few hundred UUIDs that URL exceeds the gateway's length limit and
 * PostgREST rejects the whole request with a bare "Bad Request" — no matter
 * how far under MAX_BULK_IDS the selection is. Batching keeps every request
 * well under that limit regardless of how many rows are selected.
 */
const ID_BATCH_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** The columns planBatchRekey and its callers need off a selected row. */
type SelectedRow = BatchRekeyRow & { created_at: string };

/**
 * Reads the selected rows, owner-scoped and batched the same way every other
 * bulk read here is (hard constraint 3: RLS alone would also hand back a
 * friend's tradable-binder rows sharing an id namespace with nothing — this
 * filter is what makes the read mean "mine"). Sorted by creation order once
 * the whole selection is in hand, matching bulkMerge's existing rule for
 * which row a merge keeps.
 */
async function loadSelectedRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ids: string[],
): Promise<{ rows: SelectedRow[]; error: string | null }> {
  const rows: SelectedRow[] = [];
  for (const batch of chunk(ids, ID_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("card_instances")
      .select("id, card_id, condition, finish, language, location_id, notes, quantity, created_at")
      .eq("owner_user_id", userId)
      .in("id", batch);
    if (error) return { rows: [], error: error.message };
    rows.push(...((data ?? []) as SelectedRow[]));
  }
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { rows, error: null };
}

/**
 * Every one of the caller's own rows sharing a card_id with something in the
 * selection, at ANY location — the seed set planBatchRekey needs to find a
 * merge candidate wherever a row in the batch is headed. See that function's
 * header for why reading broadly here is safe, not just convenient.
 */
async function loadExistingByCardIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  cardIds: string[],
): Promise<{ rows: BatchRekeyRow[]; error: string | null }> {
  const rows: BatchRekeyRow[] = [];
  const distinct = [...new Set(cardIds)];
  for (const batch of chunk(distinct, ID_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("card_instances")
      .select("id, card_id, condition, finish, language, location_id, notes, quantity")
      .eq("owner_user_id", userId)
      .in("card_id", batch);
    if (error) return { rows: [], error: error.message };
    rows.push(...((data ?? []) as BatchRekeyRow[]));
  }
  return { rows, error: null };
}

function revalidate() {
  revalidatePath("/collection");
  revalidatePath("/locations");
  revalidatePath("/dashboard");
  // A bulk move (or delete, or a merge that collapses stacks) can change what
  // is sleeved in a deck — a card filed into a deck here is on its list via
  // the migration-16/19 trigger. "layout" so every /decks/[id] page is busted,
  // not just the index, since the move does not know which deck it touched.
  revalidatePath("/decks", "layout");
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

export async function bulkMove(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const selection = readIds(formData);
  if (!selection.ok) return fail(selection.error);

  const raw = String(formData.get("location_id") ?? "").trim();
  // An empty value is "Unsorted", which is a real destination, not a missing one.
  const locationId = raw === "" ? null : raw;

  const supabase = await createClient();

  const { rows: selected, error: selectError } = await loadSelectedRows(supabase, user.id, selection.ids);
  if (selectError) return fail(selectError);

  // Already there: nothing to do, and not a step apply_stack_rekey needs to
  // see (an unchanged key is harmless but pointless work).
  const rows = selected.filter((row) => row.location_id !== locationId);
  if (rows.length === 0) return ok("Moved 0 entries.");

  const { rows: existing, error: existingError } = await loadExistingByCardIds(
    supabase,
    user.id,
    rows.map((r) => r.card_id),
  );
  if (existingError) return fail(existingError);

  // Merges into a matching stack already at the destination, or an identical
  // stack elsewhere in this same selection — the missing-merge bug the
  // architect's impact map found here (apps/mobile/docs/BACKLOG.md item 2).
  const steps = planBatchRekey(
    rows,
    (row) => ({ condition: row.condition, finish: row.finish, language: row.language, location_id: locationId }),
    existing,
  );

  const { results, error } = await applyStackRekey(supabase, steps);
  if (error) return fail(`Move stopped part-way: ${error}`);

  revalidate();
  return ok(`Moved ${plural(results?.length ?? rows.length, "entry", "entries")}.`);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function bulkDelete(_prev: BulkState, formData: FormData): Promise<BulkState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const selection = readIds(formData);
  if (!selection.ok) return fail(selection.error);

  const supabase = await createClient();
  let deleted = 0;
  for (const batch of chunk(selection.ids, ID_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("card_instances")
      .delete()
      .in("id", batch)
      .select("id");
    if (error) return fail(error.message);
    deleted += data?.length ?? 0;
  }

  revalidate();
  return ok(`Deleted ${plural(deleted, "entry", "entries")}.`);
}

// ---------------------------------------------------------------------------
// Set condition / finish / language
// ---------------------------------------------------------------------------

export async function bulkSetField(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const selection = readIds(formData);
  if (!selection.ok) return fail(selection.error);

  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "").trim();

  // Whitelisted rather than passed through: `field` names a column, and an
  // unchecked value here would let the browser choose what to write.
  const allowed: Record<string, readonly string[]> = {
    condition: CONDITIONS,
    finish: FINISHES,
    language: LANGUAGES.map((l) => l.code),
  };

  const vocabulary = allowed[field];
  if (!vocabulary) return fail("That field cannot be set in bulk.");
  if (!vocabulary.includes(value)) return fail(`"${value}" is not a valid ${field}.`);
  const key = field as "condition" | "finish" | "language";

  const supabase = await createClient();

  const { rows: selected, error: selectError } = await loadSelectedRows(supabase, user.id, selection.ids);
  if (selectError) return fail(selectError);

  const rows = selected.filter((row) => row[key] !== value);
  if (rows.length === 0) return ok(`Set ${field} on 0 entries.`);

  const { rows: existing, error: existingError } = await loadExistingByCardIds(
    supabase,
    user.id,
    rows.map((r) => r.card_id),
  );
  if (existingError) return fail(existingError);

  // Merges into a matching stack that already has this value, or an
  // identical stack elsewhere in this same selection.
  const steps = planBatchRekey(
    rows,
    (row) => ({ ...row, [key]: value }),
    existing,
  );

  const { results, error } = await applyStackRekey(supabase, steps);
  if (error) return fail(`Update stopped part-way: ${error}`);

  revalidate();
  return ok(`Set ${field} on ${plural(results?.length ?? rows.length, "entry", "entries")}.`);
}

// ---------------------------------------------------------------------------
// Merge duplicate stacks
// ---------------------------------------------------------------------------

/**
 * Collapses selected rows that describe the same physical stack.
 *
 * "The same" means the stack key from src/lib/collection/stacking.ts: printing,
 * condition, finish, language and location. An annotated row never merges —
 * a note is about one specific card, and folding it into a pile would lose
 * which card it referred to.
 *
 * Folded into apply_stack_rekey (migration 41) rather than kept as its own
 * two-request read-decide-write: that closes the same lost-copies-on-partial-
 * failure window unsleeveCopies and removeEntryFromList had (this action was
 * never actually atomic, only order-safe — PR #79 fixed the inflation bug,
 * not the "network drops between the delete and the update" case), and adds
 * the owner filter this read used to be missing entirely (hard constraint 3
 * — exploitable only via a hand-crafted request, since RLS's own UPDATE
 * policy would still refuse the actual write, but a real gap the architect's
 * impact map found).
 */
export async function bulkMerge(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const selection = readIds(formData);
  if (!selection.ok) return fail(selection.error);

  const supabase = await createClient();

  const { rows, error: selectError } = await loadSelectedRows(supabase, user.id, selection.ids);
  if (selectError) return fail(selectError);

  const groups = new Map<string, SelectedRow[]>();

  for (const row of rows) {
    if (row.notes && row.notes.trim() !== "") continue;
    const key = [
      row.card_id,
      row.condition,
      row.finish,
      row.language,
      row.location_id ?? "~unsorted",
    ].join(" ");
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const mergeable = [...groups.values()].filter((g) => g.length > 1);
  if (mergeable.length === 0) {
    return fail("Nothing in that selection can be merged — no two rows describe the same stack.");
  }

  // Oldest row in each group wins: it is the one whose id may already be
  // linked elsewhere, and keeping it preserves the original acquisition date.
  // Every other row in the group becomes a merge-into-the-keeper step, at its
  // own current (already-matching) key — apply_stack_rekey's merge branch
  // handles the delete-then-increment ordering migration 39's header
  // requires, the same way it already does for every other merge in this
  // family.
  const steps = mergeable.flatMap(([keep, ...rest]) =>
    rest.map((row) => ({
      mode: "rekey" as const,
      source_instance_id: row.id,
      quantity: row.quantity,
      condition: row.condition,
      finish: row.finish,
      language: row.language,
      location_id: row.location_id,
      notes: row.notes,
      target_instance_id: keep.id,
    })),
  );

  const { results, error } = await applyStackRekey(supabase, steps);
  if (error) return fail(`Merge stopped part-way: ${error}`);

  const absorbed = results?.length ?? steps.length;

  revalidate();
  return ok(
    `Merged ${plural(absorbed + mergeable.length, "entry", "entries")} into ${plural(mergeable.length, "stack")}.`,
  );
}
