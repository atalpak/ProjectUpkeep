"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { MAX_INPUT_BYTES } from "@/app/(app)/collection/import/action-state";
import { parseImport } from "@/lib/import/parse";
import { resolveRows } from "@/lib/import/resolve";
import {
  deckImportKey,
  planDeckImport,
  splitAgainstDeck,
  type DeckImportPlan,
} from "@/lib/import/deck-plan";
import {
  DECK_PREVIEW_ROW_LIMIT,
  type DeckImportPreview,
  type DeckImportState,
} from "@/app/(app)/decks/import/deck-import-state";

/**
 * Importing a decklist.
 *
 * A decklist is finish/condition/language-agnostic — an entry names a printing
 * and a count — so this is much lighter than the collection importer. It leans
 * on the same parser and printing resolver (parseImport, resolveRows), folds
 * the result to one row per printing (planDeckImport), then upserts into
 * `deck_cards`: an existing entry for that printing has the quantity added on
 * top, anything new is inserted. Both actions re-derive everything from the raw
 * text — the browser never gets to nominate card ids.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

function fail(message: string): DeckImportState {
  return { error: message, notice: null, preview: null };
}

function readForm(
  formData: FormData,
): { ok: true; deckId: string; source: string } | { ok: false; error: string } {
  const deckId = String(formData.get("deck_id") ?? "").trim();
  const source = String(formData.get("source") ?? "");

  if (!deckId) return { ok: false, error: "Which deck is this for?" };
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

  return { ok: true, deckId, source };
}

/**
 * A deck is a `locations` row of type 'deck' (see getDeck in
 * src/lib/collection/queries.ts). RLS scopes `locations` to the owner, so a hit
 * here is proof this deck exists and belongs to the signed-in user.
 */
async function ownsDeck(supabase: Supabase, deckId: string): Promise<boolean> {
  const { data } = await supabase
    .from("locations")
    .select("id")
    .eq("id", deckId)
    .eq("type", "deck")
    .maybeSingle();
  return Boolean(data);
}

async function buildPlan(
  source: string,
): Promise<{ parsed: ReturnType<typeof parseImport>; plan: DeckImportPlan }> {
  const parsed = parseImport(source);
  const resolved = await resolveRows(parsed.rows);
  return { parsed, plan: planDeckImport(resolved) };
}

/**
 * The deck's current entries, keyed by card name (via deckImportKey).
 *
 * Import lines are matched to existing entries by name, not printing — the same
 * fold planDeckImport does — so importing "Forest" into a deck that already
 * lists a Forest bumps that entry rather than adding a second one.
 */
async function currentEntriesByName(
  supabase: Supabase,
  deckId: string,
): Promise<Map<string, { id: string; quantity: number }>> {
  const out = new Map<string, { id: string; quantity: number }>();

  const { data } = await supabase
    .from("deck_cards")
    .select("id, quantity, cards ( name )")
    .eq("deck_id", deckId);

  for (const row of (data ?? []) as unknown as Array<{
    id: string;
    quantity: number;
    cards: { name: string } | null;
  }>) {
    const name = row.cards?.name;
    if (name) out.set(deckImportKey(name), { id: row.id, quantity: row.quantity });
  }
  return out;
}

function toPreview(
  parsed: ReturnType<typeof parseImport>,
  plan: DeckImportPlan,
  split: { newEntries: number; mergedEntries: number },
): DeckImportPreview {
  const shown = plan.lines.slice(0, DECK_PREVIEW_ROW_LIMIT);

  return {
    format: parsed.format,
    totalCards: plan.totalCards,
    matchedRows: plan.lines.length,
    newEntries: split.newEntries,
    mergedEntries: split.mergedEntries,
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

function revalidateDeck(deckId: string) {
  revalidatePath("/decks");
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Preview — writes nothing
// ---------------------------------------------------------------------------

export async function previewDeckImport(
  _prev: DeckImportState,
  formData: FormData,
): Promise<DeckImportState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const form = readForm(formData);
  if (!form.ok) return fail(form.error);

  const supabase = await createClient();
  if (!(await ownsDeck(supabase, form.deckId))) return fail("That deck could not be found.");

  const { parsed, plan } = await buildPlan(form.source);

  if (
    parsed.format === "empty" ||
    (plan.lines.length === 0 && plan.unmatched.length === 0 && parsed.problems.length === 0)
  ) {
    return fail("Nothing to import — no card lines were found.");
  }

  const existing = await currentEntriesByName(supabase, form.deckId);
  const split = splitAgainstDeck(plan.lines, existing.keys());

  return {
    error: null,
    notice:
      plan.lines.length === 0
        ? "Nothing here matched a card. Check the format below."
        : null,
    preview: toPreview(parsed, plan, split),
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export async function runDeckImport(
  _prev: DeckImportState,
  formData: FormData,
): Promise<DeckImportState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const form = readForm(formData);
  if (!form.ok) return fail(form.error);

  const supabase = await createClient();
  if (!(await ownsDeck(supabase, form.deckId))) return fail("That deck could not be found.");

  const { parsed, plan } = await buildPlan(form.source);

  if (plan.lines.length === 0) {
    return {
      ...fail("Nothing here matched a card, so nothing was added."),
      preview: toPreview(parsed, plan, { newEntries: 0, mergedEntries: 0 }),
    };
  }

  const existing = await currentEntriesByName(supabase, form.deckId);

  const inserts: Array<{ deck_id: string; card_id: string; quantity: number }> = [];
  let merged = 0;
  let cardsWritten = 0;
  let failure: string | null = null;

  for (const line of plan.lines) {
    const current = existing.get(deckImportKey(line.name));
    if (!current) {
      inserts.push({ deck_id: form.deckId, card_id: line.cardId, quantity: line.quantity });
      continue;
    }

    const { error } = await supabase
      .from("deck_cards")
      .update({ quantity: current.quantity + line.quantity })
      .eq("id", current.id);

    if (error) {
      failure = error.message;
      break;
    }
    merged += 1;
    cardsWritten += line.quantity;
  }

  let insertedEntries = 0;
  if (!failure && inserts.length > 0) {
    const { error } = await supabase.from("deck_cards").insert(inserts);
    if (error) {
      failure = error.message;
    } else {
      insertedEntries = inserts.length;
      cardsWritten += inserts.reduce((sum, row) => sum + row.quantity, 0);
    }
  }

  revalidateDeck(form.deckId);

  const preview = toPreview(parsed, plan, {
    newEntries: insertedEntries,
    mergedEntries: merged,
  });

  if (failure) {
    return {
      error: `${failure} ${cardsWritten} card${
        cardsWritten === 1 ? "" : "s"
      } were added before it stopped.`,
      notice: null,
      preview,
    };
  }

  const parts = [
    `Added ${cardsWritten} card${cardsWritten === 1 ? "" : "s"} to the list`,
    insertedEntries > 0
      ? `${insertedEntries} new entr${insertedEntries === 1 ? "y" : "ies"}`
      : null,
    merged > 0 ? `${merged} merged into existing entries` : null,
    preview.skipped.length > 0 ? `${preview.skipped.length} line(s) skipped` : null,
  ].filter(Boolean);

  return {
    error: null,
    notice: `${parts.join(" · ")}.`,
    preview,
    nonce: crypto.randomUUID(),
  };
}
