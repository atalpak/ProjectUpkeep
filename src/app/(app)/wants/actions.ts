"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isMissingColumnError } from "@/lib/supabase/errors";
import type { SocialState } from "@/app/(app)/social-state";

/**
 * Wish-list writes.
 *
 * A wish names a card, not a printing — so "add" takes a card name and this
 * layer picks a representative printing for the art and the oracle id. Matching
 * against friends' binders is by oracle id later, so the choice here only
 * affects what the row looks like, not what can fill it.
 */

function fail(message: string): SocialState {
  return { error: message, notice: null };
}

function ok(message: string): SocialState {
  return { error: null, notice: message, nonce: crypto.randomUUID() };
}

function revalidate(deckId?: string | null) {
  revalidatePath("/wants");
  revalidatePath("/dashboard");
  // A deck-tagged want shows up on that deck's page too (its wish list
  // section), so a change here has to invalidate that page as well.
  if (deckId) revalidatePath(`/decks/${deckId}`);
}

/** Rank printings so a want row shows a normal copy, not a promo or a token. */
const SET_TYPE_RANK: Record<string, number> = {
  core: 0,
  expansion: 0,
  draft_innovation: 1,
  commander: 1,
  masters: 2,
  starter: 3,
};

type PrintingPick = {
  scryfall_id: string;
  released_at: string | null;
  set_type: string | null;
  digital: boolean;
};

function pickRepresentative(rows: PrintingPick[]): string | null {
  const usable = rows.filter((r) => !r.digital);
  const pool = usable.length > 0 ? usable : rows;
  if (pool.length === 0) return null;

  return [...pool].sort((a, b) => {
    const ra = SET_TYPE_RANK[a.set_type ?? ""] ?? 5;
    const rb = SET_TYPE_RANK[b.set_type ?? ""] ?? 5;
    if (ra !== rb) return ra - rb;
    // Newest of the preferred kind.
    return (b.released_at ?? "").localeCompare(a.released_at ?? "");
  })[0].scryfall_id;
}

/**
 * Adds a card to the wish list, optionally tagged to a deck.
 *
 * `deck_id` is how the deck page's "add to wish list" reuses this rather than
 * reimplementing the name -> representative-printing lookup: it submits the
 * same form this function already handles, plus one extra hidden field.
 *
 * A card already on the list is not an error when a deck is given — tagging
 * an existing want to a deck ("oh, I already wanted this, it's for the Atarka
 * deck") is a more useful outcome than making the user remove and re-add it,
 * and it is what the deck page's "add" button should feel like even though
 * the row was not new. Quantity is left alone in that case: the existing want
 * already says how many, and tagging it should not silently change that.
 */
export async function addWant(_prev: SocialState, formData: FormData): Promise<SocialState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const name = String(formData.get("card_name") ?? "").trim();
  if (!name) return fail("Pick a card to add.");

  const rawQty = Number.parseInt(String(formData.get("quantity") ?? "1"), 10);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.min(rawQty, 10000) : 1;

  const rawDeckId = String(formData.get("deck_id") ?? "").trim();
  const deckId = rawDeckId === "" ? null : rawDeckId;

  const supabase = await createClient();

  const { data: printings, error: lookupError } = await supabase
    .from("cards")
    .select("scryfall_id, released_at, set_type, digital")
    .ilike("name", name)
    .limit(50);

  if (lookupError) return fail(lookupError.message);

  const cardId = pickRepresentative((printings ?? []) as PrintingPick[]);
  if (!cardId) {
    return fail(`No card called “${name}” is in the database yet.`);
  }

  const { error } = await supabase
    .from("want_list")
    .insert({ user_id: user.id, card_id: cardId, quantity, deck_id: deckId });

  if (error) {
    if (error.code === "23505" || error.message.includes("duplicate key")) {
      // Already wanted. If this add came with a deck tag, that is still a
      // useful thing to do — tag the existing row rather than reporting a
      // failure for a card the user is looking right at on this deck's page.
      if (deckId) {
        const { error: tagError } = await supabase
          .from("want_list")
          .update({ deck_id: deckId })
          .eq("user_id", user.id)
          .eq("card_id", cardId);
        if (tagError) return fail(tagError.message);
        revalidate(deckId);
        return ok(`${name} was already on your wish list — tagged it to this deck.`);
      }
      return fail(`${name} is already on your wish list.`);
    }
    if (error.code === "PGRST205") {
      return fail("The wish list is not set up on the database yet — apply migration 00000000000015.");
    }
    if (isMissingColumnError(error.code) && deckId) {
      return fail("Deck tags are not set up on the database yet — apply migration 00000000000017.");
    }
    return fail(error.message);
  }

  revalidate(deckId);
  return ok(`Added ${name} to your wish list.`);
}

export async function setWantQuantity(_prev: SocialState, formData: FormData): Promise<SocialState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const id = String(formData.get("want_id") ?? "").trim();
  const quantity = Number.parseInt(String(formData.get("quantity") ?? ""), 10);
  if (!id) return fail("Which card?");
  if (!Number.isFinite(quantity) || quantity < 1) return fail("Quantity must be at least one.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("want_list")
    .update({ quantity: Math.min(quantity, 10000) })
    .eq("id", id)
    .select("deck_id")
    .maybeSingle();

  if (error) return fail(error.message);

  revalidate((data as { deck_id: string | null } | null)?.deck_id ?? null);
  return ok("Updated.");
}

export async function removeWant(_prev: SocialState, formData: FormData): Promise<SocialState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const id = String(formData.get("want_id") ?? "").trim();
  if (!id) return fail("Which card?");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("want_list")
    .delete()
    .eq("id", id)
    .select("deck_id")
    .maybeSingle();

  if (error) return fail(error.message);

  revalidate((data as { deck_id: string | null } | null)?.deck_id ?? null);
  return ok("Removed.");
}

/**
 * Changes or clears which deck a want is tagged to.
 *
 * The one-hop version of `addWant`'s tagging branch, for the /wants page:
 * that page shows a deck picker per row rather than routing every change
 * through re-adding the card.
 */
export async function setWantDeck(_prev: SocialState, formData: FormData): Promise<SocialState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const id = String(formData.get("want_id") ?? "").trim();
  if (!id) return fail("Which card?");

  const raw = String(formData.get("deck_id") ?? "").trim();
  const deckId = raw === "" ? null : raw;

  const supabase = await createClient();

  // The previous tag also needs revalidating: untagging a deck should make
  // it disappear from that deck's wish list, not just stop appearing tagged
  // on /wants.
  const { data: before } = await supabase
    .from("want_list")
    .select("deck_id")
    .eq("id", id)
    .maybeSingle();
  const previousDeckId = (before as { deck_id: string | null } | null)?.deck_id ?? null;

  const { error } = await supabase.from("want_list").update({ deck_id: deckId }).eq("id", id);

  if (error) {
    if (isMissingColumnError(error.code)) {
      return fail("Deck tags are not set up on the database yet — apply migration 00000000000017.");
    }
    return fail(error.message);
  }

  revalidate(deckId);
  if (previousDeckId && previousDeckId !== deckId) revalidate(previousDeckId);
  return ok(deckId ? "Tagged to deck." : "Cleared deck tag.");
}
