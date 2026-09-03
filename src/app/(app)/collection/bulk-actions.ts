"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { CONDITIONS, FINISHES, LANGUAGES } from "@/lib/types";
import { MAX_BULK_IDS, type BulkState } from "@/app/(app)/collection/bulk-state";

/**
 * Bulk operations over selected collection rows.
 *
 * Ownership is enforced by row-level security rather than by re-checking here:
 * every statement runs as the signed-in user, so an id belonging to somebody
 * else simply matches no row. The counts reported back are the rows actually
 * affected, which is what makes that safe to rely on — a request naming a
 * stranger's card reports zero changes rather than silently succeeding.
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
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const selection = readIds(formData);
  if (!selection.ok) return fail(selection.error);

  const raw = String(formData.get("location_id") ?? "").trim();
  // An empty value is "Unsorted", which is a real destination, not a missing one.
  const locationId = raw === "" ? null : raw;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .update({ location_id: locationId })
    .in("id", selection.ids)
    .select("id");

  if (error) return fail(error.message);

  revalidate();
  const moved = data?.length ?? 0;
  return ok(`Moved ${plural(moved, "entry", "entries")}.`);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function bulkDelete(_prev: BulkState, formData: FormData): Promise<BulkState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const selection = readIds(formData);
  if (!selection.ok) return fail(selection.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .delete()
    .in("id", selection.ids)
    .select("id");

  if (error) return fail(error.message);

  revalidate();
  const deleted = data?.length ?? 0;
  return ok(`Deleted ${plural(deleted, "entry", "entries")}.`);
}

// ---------------------------------------------------------------------------
// Set condition / finish / language
// ---------------------------------------------------------------------------

export async function bulkSetField(_prev: BulkState, formData: FormData): Promise<BulkState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .update({ [field]: value })
    .in("id", selection.ids)
    .select("id");

  if (error) return fail(error.message);

  revalidate();
  return ok(`Set ${field} on ${plural(data?.length ?? 0, "entry", "entries")}.`);
}

// ---------------------------------------------------------------------------
// Merge duplicate stacks
// ---------------------------------------------------------------------------

type MergeRow = {
  id: string;
  card_id: string;
  location_id: string | null;
  condition: string;
  finish: string;
  language: string;
  quantity: number;
  notes: string | null;
  created_at: string;
};

/**
 * Collapses selected rows that describe the same physical stack.
 *
 * "The same" means the stack key from src/lib/collection/stacking.ts: printing,
 * condition, finish, language and location. An annotated row never merges —
 * a note is about one specific card, and folding it into a pile would lose
 * which card it referred to.
 */
export async function bulkMerge(_prev: BulkState, formData: FormData): Promise<BulkState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const selection = readIds(formData);
  if (!selection.ok) return fail(selection.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .select("id, card_id, location_id, condition, finish, language, quantity, notes, created_at")
    .in("id", selection.ids)
    .order("created_at", { ascending: true });

  if (error) return fail(error.message);

  const rows = (data ?? []) as MergeRow[];
  const groups = new Map<string, MergeRow[]>();

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

  let absorbed = 0;
  for (const group of mergeable) {
    // Oldest row wins: it is the one whose id may already be linked elsewhere,
    // and keeping it preserves the original acquisition date.
    const [keep, ...rest] = group;
    const total = group.reduce((sum, r) => sum + r.quantity, 0);

    const { error: updateError } = await supabase
      .from("card_instances")
      .update({ quantity: total })
      .eq("id", keep.id);
    if (updateError) return fail(`Merge stopped part-way: ${updateError.message}`);

    const { error: deleteError } = await supabase
      .from("card_instances")
      .delete()
      .in(
        "id",
        rest.map((r) => r.id),
      );
    if (deleteError) return fail(`Merge stopped part-way: ${deleteError.message}`);

    absorbed += rest.length;
  }

  revalidate();
  return ok(
    `Merged ${plural(absorbed + mergeable.length, "entry", "entries")} into ${plural(mergeable.length, "stack")}.`,
  );
}
