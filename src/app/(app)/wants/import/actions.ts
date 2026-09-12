"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { MAX_INPUT_BYTES } from "@/app/(app)/collection/import/action-state";
import { parseImport } from "@/lib/import/parse";
import { resolveRows } from "@/lib/import/resolve";
import { planWantImport, splitAgainstWantList, type WantImportPlan } from "@/lib/import/want-plan";
import {
  WANT_IMPORT_PREVIEW_ROW_LIMIT,
  type WantImportPreview,
  type WantImportState,
} from "@/app/(app)/wants/import/want-import-state";

/**
 * Importing a wish list.
 *
 * Leans on the same parser and printing resolver the collection and deck
 * importers use (parseImport, resolveRows), then folds the result to one row
 * per printing (planWantImport) exactly the way the deck importer does — a
 * want has no finish/condition/language for that step to carry either.
 *
 * Where this differs from the deck importer: a deck's `deck_cards` merges an
 * existing printing's quantity on import, but a manual add to the wish list
 * treats an existing want as "already there" and refuses to change its
 * quantity silently (see `addWant`/`addWants` in ../actions.ts). An import
 * follows the same rule — a printing already wanted is skipped, not bumped —
 * so pasting a list twice cannot double a quantity the way it could for a
 * deck's card count.
 */

function fail(message: string): WantImportState {
  return { error: message, notice: null, preview: null };
}

function readForm(
  formData: FormData,
): { ok: true; source: string } | { ok: false; error: string } {
  const source = String(formData.get("source") ?? "");

  if (source.trim() === "") {
    return { ok: false, error: "Paste a list or choose a file first." };
  }
  if (Buffer.byteLength(source, "utf8") > MAX_INPUT_BYTES) {
    return {
      ok: false,
      error: `That input is larger than ${Math.round(
        MAX_INPUT_BYTES / 1_000_000,
      )}MB. Split it into smaller files.`,
    };
  }

  return { ok: true, source };
}

async function buildPlan(
  source: string,
): Promise<{ parsed: ReturnType<typeof parseImport>; plan: WantImportPlan }> {
  const parsed = parseImport(source);
  const resolved = await resolveRows(parsed.rows);
  return { parsed, plan: planWantImport(resolved) };
}

/** The signed-in user's existing wants for the printings we are about to touch. */
async function existingCardIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  cardIds: string[],
): Promise<Set<string>> {
  if (cardIds.length === 0) return new Set();

  const { data } = await supabase
    .from("want_list")
    .select("card_id")
    .eq("user_id", userId)
    .in("card_id", cardIds);

  return new Set(((data ?? []) as Array<{ card_id: string }>).map((r) => r.card_id));
}

function toPreview(
  parsed: ReturnType<typeof parseImport>,
  plan: WantImportPlan,
  split: { newEntries: number; alreadyWanted: number },
): WantImportPreview {
  const shown = plan.lines.slice(0, WANT_IMPORT_PREVIEW_ROW_LIMIT);

  return {
    format: parsed.format,
    totalCards: plan.totalCards,
    matchedRows: plan.lines.length,
    newEntries: split.newEntries,
    alreadyWanted: split.alreadyWanted,
    rows: shown.map((line) => ({
      line: line.line,
      quantity: line.quantity,
      name: line.name,
      matched: line.matched,
      setCode: line.setCode,
      imageUri: line.imageUri,
      cardId: line.cardId,
    })),
    rowsTruncated: plan.lines.length > shown.length,
    skipped: plan.unmatched,
    problems: parsed.problems,
  };
}

function revalidate() {
  revalidatePath("/wants");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Preview — writes nothing
// ---------------------------------------------------------------------------

export async function previewWantImport(
  _prev: WantImportState,
  formData: FormData,
): Promise<WantImportState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const form = readForm(formData);
  if (!form.ok) return fail(form.error);

  const { parsed, plan } = await buildPlan(form.source);

  if (
    parsed.format === "empty" ||
    (plan.lines.length === 0 && plan.unmatched.length === 0 && parsed.problems.length === 0)
  ) {
    return fail("Nothing to import — no card lines were found.");
  }

  const supabase = await createClient();
  const already = await existingCardIds(supabase, user.id, plan.lines.map((l) => l.cardId));
  const split = splitAgainstWantList(plan.lines, already);

  return {
    error: null,
    notice: plan.lines.length === 0 ? "Nothing here matched a card. Check the format below." : null,
    preview: toPreview(parsed, plan, split),
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export async function runWantImport(
  _prev: WantImportState,
  formData: FormData,
): Promise<WantImportState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const form = readForm(formData);
  if (!form.ok) return fail(form.error);

  const { parsed, plan } = await buildPlan(form.source);

  if (plan.lines.length === 0) {
    return {
      ...fail("Nothing here matched a card, so nothing was added."),
      preview: toPreview(parsed, plan, { newEntries: 0, alreadyWanted: 0 }),
    };
  }

  const supabase = await createClient();
  const already = await existingCardIds(supabase, user.id, plan.lines.map((l) => l.cardId));

  const toInsert = plan.lines
    .filter((line) => !already.has(line.cardId))
    .map((line) => ({ user_id: user.id, card_id: line.cardId, quantity: line.quantity }));

  let cardsWritten = 0;
  let failure: string | null = null;

  if (toInsert.length > 0) {
    const { error } = await supabase.from("want_list").insert(toInsert);
    if (error) {
      failure = error.message;
    } else {
      cardsWritten = toInsert.reduce((sum, row) => sum + row.quantity, 0);
    }
  }

  revalidate();

  const split = splitAgainstWantList(plan.lines, already);
  const preview = toPreview(parsed, plan, split);

  if (failure) {
    return {
      error: `${failure} Nothing was added.`,
      notice: null,
      preview,
    };
  }

  const parts = [
    `Added ${cardsWritten} card${cardsWritten === 1 ? "" : "s"} to your wish list`,
    toInsert.length > 0 ? `${toInsert.length} new entr${toInsert.length === 1 ? "y" : "ies"}` : null,
    split.alreadyWanted > 0 ? `${split.alreadyWanted} already there` : null,
    preview.skipped.length > 0 ? `${preview.skipped.length} line(s) skipped` : null,
  ].filter(Boolean);

  return {
    error: null,
    notice: `${parts.join(" · ")}.`,
    preview,
    nonce: crypto.randomUUID(),
  };
}
