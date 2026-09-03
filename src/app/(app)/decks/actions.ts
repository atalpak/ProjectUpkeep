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

/**
 * Pulls physical copies out of the collection and into the deck.
 *
 * Any printing of the same card satisfies a list entry, so this matches on
 * oracle id rather than on the exact printing the entry names.
 *
 * Smallest suitable stacks are used first, so a playset kept together in a
 * binder is not broken up while a loose single sits elsewhere. Splitting only
 * happens when it must, and copies arriving in the deck merge with an identical
 * stack already there through the same policy the add form and importer use.
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

  const { data: listed } = await supabase
    .from("cards")
    .select("oracle_id, name")
    .eq("scryfall_id", cardId)
    .maybeSingle();

  if (!listed) return fail("That card is not in the database.");
  const target = listed as { oracle_id: string | null; name: string };

  const { data: owned, error } = await supabase
    .from("card_instances")
    .select(
      "id, card_id, condition, finish, language, quantity, notes, cards ( oracle_id, name ), locations!location_id ( type )",
    )
    .eq("owner_user_id", user.id);

  if (error) return fail(error.message);

  const candidates = ((owned ?? []) as unknown as SleeveCandidate[])
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
  if (availableTotal === 0) return fail("You have no spare copies of that card.");

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
      if (moveError) return fail(moveError.message);
    } else {
      if (take === source.quantity) {
        const { error: dropError } = await supabase
          .from("card_instances")
          .delete()
          .eq("id", source.id);
        if (dropError) return fail(dropError.message);
      } else {
        const { error: splitError } = await supabase
          .from("card_instances")
          .update({ quantity: source.quantity - take })
          .eq("id", source.id);
        if (splitError) return fail(splitError.message);
      }

      if (decision.action === "merge") {
        const { error: mergeError } = await supabase
          .from("card_instances")
          .update({ quantity: decision.newQuantity })
          .eq("id", decision.instanceId);
        if (mergeError) return fail(mergeError.message);
      } else {
        const { error: insertError } = await supabase.from("card_instances").insert({
          owner_user_id: user.id,
          card_id: source.card_id,
          location_id: deckId,
          condition: source.condition,
          finish: source.finish,
          language: source.language,
          quantity: take,
          notes: source.notes,
        });
        if (insertError) return fail(insertError.message);
      }
    }

    remaining -= take;
  }

  revalidate(deckId);
  return ok(
    taking < wanted
      ? `Sleeved ${taking} — that was all you had spare.`
      : `Sleeved ${taking} ${taking === 1 ? "copy" : "copies"}.`,
  );
}

/**
 * Sends sleeved copies back to the collection.
 *
 * They land unsorted rather than back where they came from: nothing records
 * where a card was before it was sleeved, and inventing a binder would be a
 * guess about a physical action the user still has to perform.
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

  let remaining = Number.isFinite(wanted) && wanted > 0 ? wanted : 1;

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
          owner_user_id: user.id,
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

  revalidate(deckId);
}
