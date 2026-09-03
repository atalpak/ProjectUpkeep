"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { decideStacking } from "@/lib/collection/stacking";
import { planSplit, takeableFrom } from "@/lib/collection/availability";
import type { DeckState } from "@/app/(app)/decks/deck-state";

/**
 * Moving cards in and out of decks.
 *
 * A deck is a physical container, so "add to deck" is a move, not a
 * reservation. That is what keeps availability honest: there is one answer to
 * where a card is, and a copy is free exactly when it is not sitting in a deck.
 *
 * The interesting case is a partial take. Owning a stack of four and wanting
 * one in a deck means the stack has to split: three stay where they were, one
 * goes to the deck, and the copy arriving in the deck merges with any identical
 * stack already there — through the same stacking policy the add form and the
 * importer use, so all three agree on what "identical" means.
 */

function fail(message: string): DeckState {
  return { error: message, notice: null };
}

function ok(message: string): DeckState {
  return { error: null, notice: message, nonce: crypto.randomUUID() };
}

function revalidate(deckId?: string) {
  revalidatePath("/collection");
  revalidatePath("/decks");
  revalidatePath("/dashboard");
  if (deckId) revalidatePath(`/decks/${deckId}`);
}

// ---------------------------------------------------------------------------
// Deck lifecycle
// ---------------------------------------------------------------------------

export async function createDeck(_prev: DeckState, formData: FormData): Promise<DeckState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const name = String(formData.get("name") ?? "").trim();
  if (name === "") return fail("Give the deck a name.");
  if (name.length > 80) return fail("That name is too long.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .insert({ user_id: user.id, name, type: "deck" });

  if (error) {
    if (error.message.includes("duplicate key")) return fail("You already have a deck called that.");
    return fail(error.message);
  }

  revalidate();
  return ok(`Created "${name}".`);
}

export async function renameDeck(_prev: DeckState, formData: FormData): Promise<DeckState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const deckId = String(formData.get("deck_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!deckId) return fail("Which deck?");
  if (name === "") return fail("Give the deck a name.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .update({ name })
    .eq("id", deckId)
    .eq("type", "deck");

  if (error) return fail(error.message);

  revalidate(deckId);
  return ok("Renamed.");
}

/**
 * The deck page's editor: name plus the details columns from migration 21
 * (format, archetype tags, notes). One round trip so a save is atomic.
 */
export async function updateDeckDetails(
  _prev: DeckState,
  formData: FormData,
): Promise<DeckState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const deckId = String(formData.get("deck_id") ?? "").trim();
  if (!deckId) return fail("Which deck?");

  const name = String(formData.get("name") ?? "").trim();
  if (name === "") return fail("Give the deck a name.");
  if (name.length > 80) return fail("That name is too long.");

  const rawFormat = String(formData.get("format") ?? "").trim();
  if (rawFormat.length > 40) return fail("That format name is too long.");
  const format = rawFormat === "" ? null : rawFormat;

  const rawNotes = String(formData.get("notes") ?? "");
  if (rawNotes.length > 5000) {
    return fail("Those notes are too long (5000 characters max).");
  }
  const notes = rawNotes.trim() === "" ? null : rawNotes;

  // Tags arrive newline- (or comma-) separated from the chip editor. Trim,
  // clamp each, drop blanks and case-insensitive duplicates, cap the count.
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of String(formData.get("tags") ?? "").split(/[\n,]/)) {
    const tag = part.trim().slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 20) break;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .update({ name, format, notes, tags })
    .eq("id", deckId)
    .eq("type", "deck");

  if (error) {
    if (error.message.includes("duplicate key")) {
      return fail("You already have a deck called that.");
    }
    return fail(error.message);
  }

  revalidate(deckId);
  return ok("Details saved.");
}

/**
 * Deletes a deck.
 *
 * The cards in it are not deleted. `locations.location_id` is ON DELETE SET
 * NULL, so they become unsorted — and immediately available again, which is the
 * right answer for taking a deck apart.
 */
export async function deleteDeck(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const deckId = String(formData.get("deck_id") ?? "").trim();
  if (!deckId) return;

  const supabase = await createClient();
  await supabase.from("locations").delete().eq("id", deckId).eq("type", "deck");

  revalidate();
}

// ---------------------------------------------------------------------------
// Adding from the collection
// ---------------------------------------------------------------------------

type StackRow = {
  id: string;
  card_id: string;
  location_id: string | null;
  condition: string;
  finish: string;
  language: string;
  quantity: number;
  notes: string | null;
  locations: { type: string } | null;
};

export async function addToDeck(_prev: DeckState, formData: FormData): Promise<DeckState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const deckId = String(formData.get("deck_id") ?? "").trim();
  const instanceId = String(formData.get("instance_id") ?? "").trim();
  const wanted = Number.parseInt(String(formData.get("quantity") ?? "1"), 10);

  if (!deckId || !instanceId) return fail("Pick a card to add.");

  const supabase = await createClient();

  const { data: source, error: readError } = await supabase
    .from("card_instances")
    .select(
      "id, card_id, location_id, condition, finish, language, quantity, notes, locations!location_id ( type )",
    )
    .eq("id", instanceId)
    .maybeSingle();

  if (readError) return fail(readError.message);
  if (!source) return fail("That card is no longer in your collection.");

  const stack = source as unknown as StackRow;

  // Re-checked here rather than trusted from the form: the picker was rendered
  // from a snapshot, and the card may have been moved since.
  const takeable = takeableFrom({
    quantity: stack.quantity,
    locations: stack.locations as { id: string; name: string; type: "deck" } | null,
  });

  const plan = planSplit(takeable, wanted);
  if ("error" in plan) return fail(plan.error);

  // Does the deck already hold an identical stack to merge into?
  const { data: candidates, error: lookupError } = await supabase
    .from("card_instances")
    .select("id, quantity, notes")
    .eq("card_id", stack.card_id)
    .eq("condition", stack.condition)
    .eq("finish", stack.finish)
    .eq("language", stack.language)
    .eq("location_id", deckId);

  if (lookupError) return fail(lookupError.message);

  const taking = plan.action === "moveWhole" ? plan.quantity : plan.take;

  const decision = decideStacking(
    {
      card_id: stack.card_id,
      condition: stack.condition as StackRow["condition"] & string,
      finish: stack.finish,
      language: stack.language,
      location_id: deckId,
      notes: stack.notes,
      quantity: taking,
      // The cast keeps this readable; the vocabulary is enforced by the CHECK
      // constraints and by whatever wrote the row in the first place.
    } as Parameters<typeof decideStacking>[0],
    candidates ?? [],
  );

  if (plan.action === "moveWhole" && decision.action === "insert") {
    // Nothing to merge with and nothing left behind: move the row itself, which
    // keeps its id, notes and acquisition date.
    const { error } = await supabase
      .from("card_instances")
      .update({ location_id: deckId })
      .eq("id", stack.id);
    if (error) return fail(error.message);
  } else {
    // Either we are splitting, or an identical stack is already in the deck.
    if (plan.action === "split") {
      const { error } = await supabase
        .from("card_instances")
        .update({ quantity: plan.leave })
        .eq("id", stack.id);
      if (error) return fail(error.message);
    } else {
      const { error } = await supabase.from("card_instances").delete().eq("id", stack.id);
      if (error) return fail(error.message);
    }

    if (decision.action === "merge") {
      const { error } = await supabase
        .from("card_instances")
        .update({ quantity: decision.newQuantity })
        .eq("id", decision.instanceId);
      if (error) return fail(error.message);
    } else {
      const { error } = await supabase.from("card_instances").insert({
        owner_user_id: user.id,
        card_id: stack.card_id,
        location_id: deckId,
        condition: stack.condition,
        finish: stack.finish,
        language: stack.language,
        quantity: taking,
        notes: stack.notes,
      });
      if (error) return fail(error.message);
    }
  }

  revalidate(deckId);
  return ok(`Added ${taking} ${taking === 1 ? "copy" : "copies"}.`);
}

/**
 * Takes cards back out of a deck.
 *
 * Sends them to Unsorted rather than to wherever they came from: the collection
 * does not record where a card was before, and inventing a destination would be
 * a guess about a physical action the user has to perform anyway.
 */
export async function removeFromDeck(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const instanceId = String(formData.get("instance_id") ?? "").trim();
  const deckId = String(formData.get("deck_id") ?? "").trim();
  if (!instanceId) return;

  const supabase = await createClient();
  await supabase.from("card_instances").update({ location_id: null }).eq("id", instanceId);

  revalidate(deckId);
}

// ---------------------------------------------------------------------------
// Commander
// ---------------------------------------------------------------------------

/**
 * Nominates one card on the deck's list as its commander, or clears the
 * nomination.
 *
 * Stored on the deck rather than the card: the same Atarka is a plain legendary
 * creature in a binder, and only a commander in the deck that named it.
 *
 * Keyed on the card (`cards.scryfall_id`, via migration 00000000000018), not a
 * physical copy — a commander has to be nominable before you own one, the
 * same way any other line on the decklist can be. The previous shape keyed
 * this on `card_instances.id`, which meant the FK rejected every attempt to
 * nominate a card you had not yet sleeved, and the caller swallowed that
 * error instead of surfacing it; nominations silently did nothing. This
 * returns DeckState now specifically so that cannot happen again unnoticed.
 *
 * Nothing checks legality here — not that the card is legendary, not that the
 * deck is Commander format. Format validation is out of scope by charter, and a
 * rule that argued with the user about their own deck would be worse than none.
 */
export async function setCommander(_prev: DeckState, formData: FormData): Promise<DeckState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const deckId = String(formData.get("deck_id") ?? "").trim();
  const raw = String(formData.get("card_id") ?? "").trim();
  if (!deckId) return fail("Which deck?");

  // An empty card id clears the designation.
  const cardId = raw === "" ? null : raw;

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .update({ commander_card_id: cardId })
    .eq("id", deckId)
    .eq("type", "deck");

  if (error) {
    // A missing column means migration 00000000000018 has not been applied.
    // Naming the fix beats a generic Postgres error.
    if (error.message.includes("commander_card_id")) {
      return fail("Commander needs migration 00000000000018 applied to this database.");
    }
    return fail(error.message);
  }

  revalidate(deckId);
  return ok(cardId ? "Commander set." : "Commander cleared.");
}

// ---------------------------------------------------------------------------
// The decklist
// ---------------------------------------------------------------------------

/**
 * Adds a card to the list, or raises the quantity if it is already on it.
 *
 * Listing a card is not the same as owning one. You can put four Bolts on a
 * list holding none, which is the entire reason the list exists separately from
 * the cards in the box.
 */
export async function addDeckCard(_prev: DeckState, formData: FormData): Promise<DeckState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const deckId = String(formData.get("deck_id") ?? "").trim();
  const cardId = String(formData.get("card_id") ?? "").trim();
  const quantity = Number.parseInt(String(formData.get("quantity") ?? "1"), 10);

  if (!deckId || !cardId) return fail("Pick a card to add.");
  if (!Number.isFinite(quantity) || quantity < 1) return fail("Quantity must be at least one.");

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("deck_cards")
    .select("id, quantity")
    .eq("deck_id", deckId)
    .eq("card_id", cardId)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; quantity: number };
    const { error } = await supabase
      .from("deck_cards")
      .update({ quantity: row.quantity + quantity })
      .eq("id", row.id);
    if (error) return fail(error.message);
  } else {
    const { error } = await supabase
      .from("deck_cards")
      .insert({ deck_id: deckId, card_id: cardId, quantity });
    if (error) return fail(error.message);
  }

  revalidate(deckId);
  return ok("Added to the list.");
}

/**
 * Puts an already-sleeved card onto the list.
 *
 * The plain-form counterpart of addDeckCard, for the recovery row shown when a
 * card is physically in a deck with no list entry. After migration
 * 00000000000016 the database keeps these in step and this is effectively
 * unreachable — it exists for the window before that migration is applied.
 */
export async function listDeckCard(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const deckId = String(formData.get("deck_id") ?? "").trim();
  const cardId = String(formData.get("card_id") ?? "").trim();
  const raw = Number.parseInt(String(formData.get("quantity") ?? "1"), 10);
  const quantity = Number.isFinite(raw) && raw > 0 ? raw : 1;
  if (!deckId || !cardId) return;

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("deck_cards")
    .select("id, quantity")
    .eq("deck_id", deckId)
    .eq("card_id", cardId)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; quantity: number };
    await supabase
      .from("deck_cards")
      .update({ quantity: Math.max(row.quantity, quantity) })
      .eq("id", row.id);
  } else {
    await supabase.from("deck_cards").insert({ deck_id: deckId, card_id: cardId, quantity });
  }

  revalidate(deckId);
}

export async function setDeckCardQuantity(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const entryId = String(formData.get("entry_id") ?? "").trim();
  const deckId = String(formData.get("deck_id") ?? "").trim();
  const quantity = Number.parseInt(String(formData.get("quantity") ?? "0"), 10);
  if (!entryId) return;

  const supabase = await createClient();

  // Dropping to zero removes the entry rather than storing a row that asks for
  // none of something.
  if (!Number.isFinite(quantity) || quantity < 1) {
    await supabase.from("deck_cards").delete().eq("id", entryId);
  } else {
    await supabase.from("deck_cards").update({ quantity }).eq("id", entryId);
  }

  revalidate(deckId);
}

/**
 * Removes a card from the deck.
 *
 * This is the one action that takes a card out: the list entry goes, and every
 * physical copy sleeved for it comes out of the box to Unsorted. A card is only
 * ever off a deck's list because it was pulled from the deck — there is no
 * "delete the line but leave the cardboard" state, which is what used to
 * produce cards "in the deck but not on the list".
 *
 * Sleeved copies are matched on oracle id, the same way the list reconciles
 * with the box everywhere else: any printing of the card counts.
 */
export async function removeDeckCard(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const entryId = String(formData.get("entry_id") ?? "").trim();
  const deckId = String(formData.get("deck_id") ?? "").trim();
  if (!entryId || !deckId) return;

  const supabase = await createClient();

  const { data: entry } = await supabase
    .from("deck_cards")
    .select("card_id")
    .eq("id", entryId)
    .maybeSingle();

  if (entry) {
    const cardId = (entry as { card_id: string }).card_id;

    // If this card was the deck's commander, the nomination goes with it.
    // commander_card_id points at cards.scryfall_id, and card rows are never
    // deleted, so there is no ON DELETE SET NULL to lean on the way the old
    // instance-keyed column could — it has to be cleared here. Without this,
    // re-adding the same card later silently re-nominates it (a fresh
    // deck_cards row whose card_id still matches the stale commander_card_id).
    await supabase
      .from("locations")
      .update({ commander_card_id: null })
      .eq("id", deckId)
      .eq("type", "deck")
      .eq("commander_card_id", cardId);

    const { data: listed } = await supabase
      .from("cards")
      .select("oracle_id, name")
      .eq("scryfall_id", cardId)
      .maybeSingle();
    const target = listed as { oracle_id: string | null; name: string } | null;

    if (target) {
      const { data: inDeck } = await supabase
        .from("card_instances")
        .select("id, cards ( oracle_id, name )")
        .eq("location_id", deckId);

      const ids = ((inDeck ?? []) as unknown as Array<{
        id: string;
        cards: { oracle_id: string | null; name: string } | null;
      }>)
        .filter((row) =>
          target.oracle_id
            ? row.cards?.oracle_id === target.oracle_id
            : row.cards?.name?.toLowerCase() === target.name.toLowerCase(),
        )
        .map((row) => row.id);

      if (ids.length > 0) {
        await supabase.from("card_instances").update({ location_id: null }).in("id", ids);
      }
    }
  }

  await supabase.from("deck_cards").delete().eq("id", entryId);

  revalidate(deckId);
}

/**
 * Repoints a list entry at a different printing of the same card.
 *
 * The list line names a printing (`deck_cards.card_id` is a `cards.scryfall_id`)
 * purely so the page can show the right art and set — copies are still counted
 * across every printing by oracle id, so this changes what the row *looks* like,
 * not what satisfies it.
 *
 * Guarded to the same card: the picked printing must share an oracle id (or,
 * lacking one, a name) with the entry's current printing, so this can never be
 * used to swap one card on the list for another.
 *
 * Any copies sleeved for this entry come back out to Unsorted — a printing
 * change resets the entry to unsleeved, the same way a freshly added card
 * starts, so its status goes back to Available / Not available.
 */
export async function setDeckCardPrinting(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const entryId = String(formData.get("entry_id") ?? "").trim();
  const deckId = String(formData.get("deck_id") ?? "").trim();
  const newCardId = String(formData.get("card_id") ?? "").trim();
  if (!entryId || !deckId || !newCardId) return;

  const supabase = await createClient();

  const { data: entryRow } = await supabase
    .from("deck_cards")
    .select("id, card_id, quantity")
    .eq("id", entryId)
    .maybeSingle();
  if (!entryRow) return;
  const entry = entryRow as { id: string; card_id: string; quantity: number };
  if (entry.card_id === newCardId) return;

  // Both printings, looked up by scryfall id — the switch is only allowed
  // between two printings of the same card (same oracle id, or same name when
  // a card predates oracle ids in our data).
  const { data: cardRows } = await supabase
    .from("cards")
    .select("scryfall_id, oracle_id, name")
    .in("scryfall_id", [entry.card_id, newCardId]);

  const cards = (cardRows ?? []) as Array<{
    scryfall_id: string;
    oracle_id: string | null;
    name: string;
  }>;
  const from = cards.find((c) => c.scryfall_id === entry.card_id);
  const to = cards.find((c) => c.scryfall_id === newCardId);
  if (!to) return;

  const sameCard =
    from?.oracle_id && to.oracle_id
      ? from.oracle_id === to.oracle_id
      : from?.name?.toLowerCase() === to.name.toLowerCase();
  if (!sameCard) return;

  // Reset the entry to unsleeved: pull any copies in the deck box for this
  // card back out to Unsorted before the printing moves.
  await unsleeveCopies(supabase, user.id, deckId, entry.card_id);

  // deck_cards is unique on (deck_id, card_id): if the chosen printing is
  // already its own line on this deck, fold this entry's quantity into it
  // rather than colliding.
  const { data: dupRow } = await supabase
    .from("deck_cards")
    .select("id, quantity")
    .eq("deck_id", deckId)
    .eq("card_id", newCardId)
    .maybeSingle();

  if (dupRow) {
    const dup = dupRow as { id: string; quantity: number };
    await supabase
      .from("deck_cards")
      .update({ quantity: dup.quantity + entry.quantity })
      .eq("id", dup.id);
    await supabase.from("deck_cards").delete().eq("id", entry.id);
  } else {
    await supabase.from("deck_cards").update({ card_id: newCardId }).eq("id", entry.id);
  }

  // A commander nomination points at the printing, so move it with the entry —
  // otherwise it goes stale the same way the sticky-commander bug did.
  await supabase
    .from("locations")
    .update({ commander_card_id: newCardId })
    .eq("id", deckId)
    .eq("type", "deck")
    .eq("commander_card_id", entry.card_id);

  revalidate(deckId);
}

// ---------------------------------------------------------------------------
// Sleeving
// ---------------------------------------------------------------------------

type SleeveCandidate = {
  id: string;
  card_id: string;
  condition: string;
  finish: string;
  language: string;
  quantity: number;
  notes: string | null;
  cards: { oracle_id: string | null; name: string } | null;
  locations: { type: string } | null;
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Moves up to `wanted` spare copies of one card from the collection into the
 * deck, and reports how many actually moved.
 *
 * Any printing of the same card satisfies a list entry, so this matches on
 * oracle id rather than on the exact printing the entry names. Smallest
 * suitable stacks are used first, so a playset kept together in a binder is not
 * broken up while a loose single sits elsewhere; splitting only happens when it
 * must, and copies arriving in the deck merge with an identical stack already
 * there through the same policy the add form and importer use.
 *
 * The shared core of `sleeveCard` (one card) and `bulkSleeveEntries` (a
 * selection) — both parse their input and then call this.
 */
/**
 * A snapshot of the whole collection plus the target card, so a caller
 * sleeving many cards at once can read it *once* instead of per card.
 *
 * The snapshot is not updated as stacks move, so a caller must not make two
 * calls for the same card against one pool — the second would plan against
 * copies the first already took. `bulkSleeveEntries` groups its selected
 * entries by card and makes exactly one call per card, which holds.
 */
type SleevePool = {
  candidates: SleeveCandidate[];
  target: { oracle_id: string | null; name: string };
};

async function sleeveCopies(
  supabase: SupabaseClient,
  userId: string,
  deckId: string,
  cardId: string,
  wanted: number,
  pool?: SleevePool,
): Promise<{ sleeved: number; error: string | null }> {
  let target: { oracle_id: string | null; name: string };
  let owned: SleeveCandidate[];

  if (pool) {
    target = pool.target;
    owned = pool.candidates;
  } else {
    const { data: listed } = await supabase
      .from("cards")
      .select("oracle_id, name")
      .eq("scryfall_id", cardId)
      .maybeSingle();

    if (!listed) return { sleeved: 0, error: "That card is not in the database." };
    target = listed as { oracle_id: string | null; name: string };

    const { data, error } = await supabase
      .from("card_instances")
      .select(
        "id, card_id, condition, finish, language, quantity, notes, cards ( oracle_id, name ), locations!location_id ( type )",
      )
      .eq("owner_user_id", userId);

    if (error) return { sleeved: 0, error: error.message };
    owned = (data ?? []) as unknown as SleeveCandidate[];
  }

  const candidates = owned
    .filter((row) => {
      const sameCard = target.oracle_id
        ? row.cards?.oracle_id === target.oracle_id
        : row.cards?.name?.toLowerCase() === target.name.toLowerCase();
      // Not already sleeved somewhere: moving a card out of another deck is a
      // different decision, and should be made on that deck's page.
      return sameCard && row.locations?.type !== "deck";
    })
    .sort((a, b) => a.quantity - b.quantity);

  const availableTotal = candidates.reduce((sum, c) => sum + c.quantity, 0);
  if (availableTotal === 0) return { sleeved: 0, error: "You have no spare copies of that card." };

  const taking = Math.min(wanted, availableTotal);
  let remaining = taking;

  for (const source of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, source.quantity);

    const { data: alreadyThere } = await supabase
      .from("card_instances")
      .select("id, quantity, notes")
      .eq("card_id", source.card_id)
      .eq("condition", source.condition)
      .eq("finish", source.finish)
      .eq("language", source.language)
      .eq("location_id", deckId);

    const decision = decideStacking(
      {
        card_id: source.card_id,
        condition: source.condition,
        finish: source.finish,
        language: source.language,
        location_id: deckId,
        notes: source.notes,
        quantity: take,
      } as Parameters<typeof decideStacking>[0],
      alreadyThere ?? [],
    );

    if (take === source.quantity && decision.action === "insert") {
      const { error: moveError } = await supabase
        .from("card_instances")
        .update({ location_id: deckId })
        .eq("id", source.id);
      if (moveError) return { sleeved: taking - remaining, error: moveError.message };
    } else {
      if (take === source.quantity) {
        const { error: dropError } = await supabase
          .from("card_instances")
          .delete()
          .eq("id", source.id);
        if (dropError) return { sleeved: taking - remaining, error: dropError.message };
      } else {
        const { error: splitError } = await supabase
          .from("card_instances")
          .update({ quantity: source.quantity - take })
          .eq("id", source.id);
        if (splitError) return { sleeved: taking - remaining, error: splitError.message };
      }

      if (decision.action === "merge") {
        const { error: mergeError } = await supabase
          .from("card_instances")
          .update({ quantity: decision.newQuantity })
          .eq("id", decision.instanceId);
        if (mergeError) return { sleeved: taking - remaining, error: mergeError.message };
      } else {
        const { error: insertError } = await supabase.from("card_instances").insert({
          owner_user_id: userId,
          card_id: source.card_id,
          location_id: deckId,
          condition: source.condition,
          finish: source.finish,
          language: source.language,
          quantity: take,
          notes: source.notes,
        });
        if (insertError) return { sleeved: taking - remaining, error: insertError.message };
      }
    }

    remaining -= take;
  }

  return { sleeved: taking, error: null };
}

/**
 * Pulls physical copies out of the collection and into the deck.
 */
export async function sleeveCard(_prev: DeckState, formData: FormData): Promise<DeckState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const deckId = String(formData.get("deck_id") ?? "").trim();
  const cardId = String(formData.get("card_id") ?? "").trim();
  const wanted = Number.parseInt(String(formData.get("quantity") ?? "1"), 10);

  if (!deckId || !cardId) return fail("Which card?");
  if (!Number.isFinite(wanted) || wanted < 1) return fail("Choose at least one copy.");

  const supabase = await createClient();
  const { sleeved, error } = await sleeveCopies(supabase, user.id, deckId, cardId, wanted);
  if (error) return fail(error);

  revalidate(deckId);
  return ok(
    sleeved < wanted
      ? `Sleeved ${sleeved} — that was all you had spare.`
      : `Sleeved ${sleeved} ${sleeved === 1 ? "copy" : "copies"}.`,
  );
}

/**
 * Moves sleeved copies of one card back out of the deck to Unsorted.
 *
 * `wanted` undefined means "all of them" — which is what a printing change and
 * a bulk unsleeve both want. Copies land unsorted rather than back where they
 * came from: nothing records where a card was before it was sleeved.
 *
 * The shared core of `unsleeveCard`, `bulkUnsleeveEntries` and the un-sleeve
 * step of `setDeckCardPrinting`.
 */
async function unsleeveCopies(
  supabase: SupabaseClient,
  userId: string,
  deckId: string,
  cardId: string,
  wanted?: number,
): Promise<void> {
  const { data: listed } = await supabase
    .from("cards")
    .select("oracle_id, name")
    .eq("scryfall_id", cardId)
    .maybeSingle();
  if (!listed) return;
  const target = listed as { oracle_id: string | null; name: string };

  const { data: inDeck } = await supabase
    .from("card_instances")
    .select("id, quantity, cards ( oracle_id, name )")
    .eq("location_id", deckId);

  const matching = ((inDeck ?? []) as unknown as Array<{
    id: string;
    quantity: number;
    cards: { oracle_id: string | null; name: string } | null;
  }>)
    .filter((row) =>
      target.oracle_id
        ? row.cards?.oracle_id === target.oracle_id
        : row.cards?.name?.toLowerCase() === target.name.toLowerCase(),
    )
    .sort((a, b) => a.quantity - b.quantity);

  // Undefined `wanted` (or a non-positive one) means every sleeved copy.
  let remaining =
    wanted === undefined || !Number.isFinite(wanted) || wanted <= 0
      ? matching.reduce((sum, r) => sum + r.quantity, 0)
      : wanted;

  for (const row of matching) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, row.quantity);

    if (take === row.quantity) {
      await supabase.from("card_instances").update({ location_id: null }).eq("id", row.id);
    } else {
      // Only part of this stack comes out: leave the rest sleeved.
      await supabase
        .from("card_instances")
        .update({ quantity: row.quantity - take })
        .eq("id", row.id);

      const { data: full } = await supabase
        .from("card_instances")
        .select("card_id, condition, finish, language, notes")
        .eq("id", row.id)
        .maybeSingle();

      if (full) {
        const source = full as {
          card_id: string;
          condition: string;
          finish: string;
          language: string;
          notes: string | null;
        };
        await supabase.from("card_instances").insert({
          owner_user_id: userId,
          card_id: source.card_id,
          location_id: null,
          condition: source.condition,
          finish: source.finish,
          language: source.language,
          quantity: take,
          notes: source.notes,
        });
      }
    }

    remaining -= take;
  }
}

/**
 * Sends sleeved copies back to the collection.
 *
 * The list entry stays. Unsleeving is "I took these out of the box", not "I no
 * longer want this card in the deck" — the entry simply becomes Available again.
 */
export async function unsleeveCard(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const deckId = String(formData.get("deck_id") ?? "").trim();
  const cardId = String(formData.get("card_id") ?? "").trim();
  const wanted = Number.parseInt(String(formData.get("quantity") ?? "1"), 10);
  if (!deckId || !cardId) return;

  const supabase = await createClient();
  await unsleeveCopies(supabase, user.id, deckId, cardId, wanted);

  revalidate(deckId);
}

// ---------------------------------------------------------------------------
// Bulk sleeve / unsleeve over a selection of list entries
// ---------------------------------------------------------------------------

type BulkEntry = {
  id: string;
  card_id: string;
  quantity: number;
  cards: { oracle_id: string | null; name: string } | null;
};

/** Loads the selected deck_cards rows, scoped to the one deck. */
async function loadSelectedEntries(
  supabase: SupabaseClient,
  deckId: string,
  entryIds: string[],
): Promise<BulkEntry[]> {
  if (entryIds.length === 0) return [];
  const { data } = await supabase
    .from("deck_cards")
    .select("id, card_id, quantity, cards ( oracle_id, name )")
    .eq("deck_id", deckId)
    .in("id", entryIds);
  return ((data ?? []) as unknown as BulkEntry[]);
}

function parseEntryIds(formData: FormData): string[] {
  return String(formData.get("entry_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sleeves every selected entry that can be *completed* from spare copies.
 *
 * "Completed" is per the user's call on this: an entry is sleeved only when the
 * spare copies owned cover everything it still needs. An entry that would stay
 * short is left untouched and counted, so the result can say why nothing
 * happened for it.
 */
export async function bulkSleeveEntries(
  _prev: DeckState,
  formData: FormData,
): Promise<DeckState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const deckId = String(formData.get("deck_id") ?? "").trim();
  const entryIds = parseEntryIds(formData);
  if (!deckId || entryIds.length === 0) return fail("Nothing selected.");

  const supabase = await createClient();
  const entries = await loadSelectedEntries(supabase, deckId, entryIds);

  // One read of the whole collection, reused two ways: tallied into sleeved-here
  // and spare counts for the "can this entry be completed" test, and passed
  // straight to sleeveCopies as its candidate pool so it does not re-read the
  // collection once per entry — the slow part of a big bulk sleeve.
  const { data: owned } = await supabase
    .from("card_instances")
    .select(
      "id, card_id, condition, finish, language, quantity, notes, location_id, cards ( oracle_id, name ), locations!location_id ( type )",
    )
    .eq("owner_user_id", user.id);

  const ownedRows = (owned ?? []) as unknown as Array<
    SleeveCandidate & { location_id: string | null }
  >;

  const sleevedHere = new Map<string, number>();
  const spare = new Map<string, number>();
  for (const raw of ownedRows) {
    const key = raw.cards?.oracle_id ?? raw.cards?.name?.toLowerCase();
    if (!key) continue;
    if (raw.location_id === deckId) {
      sleevedHere.set(key, (sleevedHere.get(key) ?? 0) + raw.quantity);
    } else if (raw.locations?.type !== "deck") {
      spare.set(key, (spare.get(key) ?? 0) + raw.quantity);
    }
  }

  // The pool for sleeveCopies: the same rows, minus the location_id column it
  // does not use.
  const poolCandidates: SleeveCandidate[] = ownedRows.map((r) => ({
    id: r.id,
    card_id: r.card_id,
    condition: r.condition,
    finish: r.finish,
    language: r.language,
    quantity: r.quantity,
    notes: r.notes,
    cards: r.cards,
    locations: r.locations,
  }));

  // Group the selected entries by card (oracle), because two entries for the
  // same card — 14 of one Forest art, 6 of another — draw on the same spare
  // copies. One sleeveCopies call per card, for the whole card's shortfall,
  // means the shared pool is never read stale between entries.
  type Group = {
    entryCount: number;
    outstanding: number;
    sampleCardId: string;
    target: { oracle_id: string | null; name: string };
  };
  const groups = new Map<string, Group>();
  let skipped = 0;

  for (const entry of entries) {
    const key = entry.cards?.oracle_id ?? entry.cards?.name?.toLowerCase();
    if (!key || !entry.cards) {
      skipped += 1;
      continue;
    }
    const g = groups.get(key) ?? {
      entryCount: 0,
      outstanding: 0,
      sampleCardId: entry.card_id,
      target: { oracle_id: entry.cards.oracle_id, name: entry.cards.name },
    };
    g.entryCount += 1;
    g.outstanding += entry.quantity;
    groups.set(key, g);
  }

  let completed = 0;

  for (const [key, g] of groups) {
    const outstanding = Math.max(0, g.outstanding - (sleevedHere.get(key) ?? 0));
    if (outstanding === 0) continue; // already sleeved
    if ((spare.get(key) ?? 0) < outstanding) {
      skipped += g.entryCount; // cannot finish this card from spare copies
      continue;
    }

    const { sleeved } = await sleeveCopies(
      supabase,
      user.id,
      deckId,
      g.sampleCardId,
      outstanding,
      { candidates: poolCandidates, target: g.target },
    );
    if (sleeved >= outstanding) completed += g.entryCount;
    else skipped += g.entryCount;
  }

  revalidate(deckId);

  if (completed === 0 && skipped === 0) return ok("Those entries were already sleeved.");
  const parts = [
    completed > 0 ? `Sleeved ${completed} ${completed === 1 ? "card" : "cards"}` : null,
    skipped > 0 ? `skipped ${skipped} (not enough spare copies)` : null,
  ].filter(Boolean);
  return ok(`${parts.join(" · ")}.`);
}

/** Returns every sleeved copy of each selected entry to Unsorted. */
export async function bulkUnsleeveEntries(
  _prev: DeckState,
  formData: FormData,
): Promise<DeckState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const deckId = String(formData.get("deck_id") ?? "").trim();
  const entryIds = parseEntryIds(formData);
  if (!deckId || entryIds.length === 0) return fail("Nothing selected.");

  const supabase = await createClient();
  const entries = await loadSelectedEntries(supabase, deckId, entryIds);

  for (const entry of entries) {
    await unsleeveCopies(supabase, user.id, deckId, entry.card_id);
  }

  revalidate(deckId);
  return ok(
    `Returned ${entries.length} ${entries.length === 1 ? "entry" : "entries"} to your collection.`,
  );
}
