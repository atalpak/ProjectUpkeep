"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { MAX_INPUT_BYTES } from "@/app/(app)/collection/import/action-state";
import { parseImport } from "@/lib/import/parse";
import { resolveRows } from "@/lib/import/resolve";
import { planDeckImport } from "@/lib/import/deck-plan";
import { getAvailabilityForCards } from "@/lib/collection/queries";
import { availabilityFor } from "@/lib/collection/availability";
import {
  countsFrom,
  foldByCard,
  summarize,
  type CheckCard,
  type ListLine,
} from "@/lib/collection/list-check";
import {
  MAX_CHECK_ENTRIES,
  type CheckRow,
  type ListCheckResult,
  type ListCheckState,
  type SaveDeckState,
} from "@/app/(app)/decks/check/check-state";

/**
 * Checking a list without committing to it.
 *
 * Deliberately writes nothing. The point of this screen is that browsing five
 * decks on a Sunday should not leave five junk decks behind — so it runs the
 * same pipeline the deck importer does (parseImport, resolveRows,
 * planDeckImport), then stops before the database and reconciles against what
 * you own instead.
 *
 * `saveAsDeck` is the escape hatch for when you decide you *are* building it.
 * It re-derives everything from the raw text rather than trusting card ids the
 * browser hands back, exactly as the importer does — a check result is display
 * data, not an instruction.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Exactly the columns `CheckCard` declares — one literal so the query, the
 *  type and the folding cannot drift apart. */
const CHECK_CARD_COLUMNS =
  "scryfall_id, oracle_id, name, flavor_name, set_code, collector_number, type_line, mana_cost, cmc, rarity, colors, image_uri_small";

function fail(message: string): ListCheckState {
  return { error: message, notice: null, result: null };
}

function readSource(formData: FormData): { ok: true; source: string } | { ok: false; error: string } {
  const source = String(formData.get("source") ?? "");

  if (source.trim() === "") return { ok: false, error: "Paste a list or choose a file first." };
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

/**
 * The card details a check needs, for printings the resolver has already
 * matched.
 *
 * The resolver returns what it needs to *choose* a printing — set, collector
 * number, finishes — and not the oracle id, type line or mana value this screen
 * groups and counts by. So the matched ids are read back once, in one query,
 * rather than widening the resolver's select for every import in the app.
 */
async function cardsById(
  supabase: Supabase,
  scryfallIds: string[],
): Promise<Map<string, CheckCard>> {
  const out = new Map<string, CheckCard>();
  if (scryfallIds.length === 0) return out;

  const { data, error } = await supabase
    .from("cards")
    .select(CHECK_CARD_COLUMNS)
    .in("scryfall_id", scryfallIds);

  if (error) throw new Error(`Could not read those cards: ${error.message}`);

  for (const card of (data ?? []) as CheckCard[]) out.set(card.scryfall_id, card);
  return out;
}

export async function checkList(
  _prev: ListCheckState,
  formData: FormData,
): Promise<ListCheckState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const form = readSource(formData);
  if (!form.ok) return fail(form.error);

  const parsed = parseImport(form.source);
  const resolved = await resolveRows(parsed.rows);
  const plan = planDeckImport(resolved);

  if (
    parsed.format === "empty" ||
    (plan.lines.length === 0 && plan.unmatched.length === 0 && parsed.problems.length === 0)
  ) {
    return fail("Nothing to check — no card lines were found.");
  }

  if (plan.lines.length > MAX_CHECK_ENTRIES) {
    return fail(
      `That is ${plan.lines.length} different cards. This checks a decklist — ` +
        `to file a whole collection, use Import instead.`,
    );
  }

  const supabase = await createClient();
  const details = await cardsById(
    supabase,
    plan.lines.map((line) => line.cardId),
  );

  // A printing the resolver matched but this read did not return would be a row
  // deleted between the two queries — vanishingly unlikely, and dropping it
  // silently would make the totals lie. It is reported as a skipped line.
  const lines: ListLine[] = [];
  const vanished: ListCheckResult["skipped"] = [];

  for (const line of plan.lines) {
    const card = details.get(line.cardId);
    if (!card) {
      vanished.push({
        line: line.line,
        raw: `${line.quantity} ${line.name}`,
        reason: "That card could not be read back. Try again.",
      });
      continue;
    }
    lines.push({ line: line.line, quantity: line.quantity, card });
  }

  const entries = foldByCard(lines);
  const availability = await getAvailabilityForCards(entries.map((entry) => entry.card));

  const rows: CheckRow[] = entries.map((entry) => ({
    ...countsFrom(entry.wanted, availabilityFor(availability, entry.card)),
    key: entry.key,
    line: entry.line,
    card: entry.card,
    printings: entry.printings,
  }));

  return {
    error: null,
    notice: null,
    result: {
      format: parsed.format,
      summary: summarize(rows),
      rows,
      skipped: [...plan.unmatched, ...vanished],
      problems: parsed.problems,
    },
  };
}

// ---------------------------------------------------------------------------
// Save as deck — the only thing here that writes
// ---------------------------------------------------------------------------

function saveFailed(message: string): SaveDeckState {
  return { error: message, deckId: null, deckName: null };
}

/**
 * Turns a checked list into a real deck.
 *
 * Creates the deck and writes the intended list into `deck_cards`. It does not
 * sleeve anything: a decklist is what the deck wants, and moving physical cards
 * into it is a separate, deliberate act on the deck page. That asymmetry is the
 * whole model — see src/lib/collection/deck-state.ts.
 *
 * Entries are written per printing, like the deck importer, because a deck may
 * legitimately list two arts of the same land. The check folds them together to
 * count copies; the deck keeps them apart.
 */
export async function saveAsDeck(
  _prev: SaveDeckState,
  formData: FormData,
): Promise<SaveDeckState> {
  const user = await getCurrentUser();
  if (!user) return saveFailed("You need to be signed in.");

  const name = String(formData.get("name") ?? "").trim();
  if (name === "") return saveFailed("Give the deck a name.");
  if (name.length > 80) return saveFailed("That name is too long.");

  const form = readSource(formData);
  if (!form.ok) return saveFailed(form.error);

  const parsed = parseImport(form.source);
  const resolved = await resolveRows(parsed.rows);
  const plan = planDeckImport(resolved);

  if (plan.lines.length === 0) {
    return saveFailed("Nothing here matched a card, so there is no deck to save.");
  }

  const supabase = await createClient();

  const { data: deck, error: deckError } = await supabase
    .from("locations")
    .insert({ user_id: user.id, name, type: "deck" })
    .select("id")
    .single();

  if (deckError || !deck) {
    if (deckError?.message.includes("duplicate key")) {
      return saveFailed("You already have a deck called that.");
    }
    return saveFailed(deckError?.message ?? "The deck could not be created.");
  }

  const deckId = (deck as { id: string }).id;

  const { error: cardsError } = await supabase.from("deck_cards").insert(
    plan.lines.map((line) => ({
      deck_id: deckId,
      card_id: line.cardId,
      quantity: line.quantity,
    })),
  );

  revalidatePath("/decks");
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/dashboard");

  if (cardsError) {
    // The deck exists but is empty or partial. Say so plainly rather than
    // deleting it behind your back — the name is taken either way, and an empty
    // deck you can see is easier to deal with than one that silently vanished.
    return {
      error: `"${name}" was created, but its list could not be written: ${cardsError.message}`,
      deckId,
      deckName: name,
    };
  }

  return { error: null, deckId, deckName: name };
}
