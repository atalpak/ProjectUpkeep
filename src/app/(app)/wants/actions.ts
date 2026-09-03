"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { SocialState } from "@/app/(app)/social-state";

/**
 * Want-list writes.
 *
 * A want names a card, not a printing — so "add" takes a card name and this
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

function revalidate() {
  revalidatePath("/wants");
  revalidatePath("/dashboard");
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

export async function addWant(_prev: SocialState, formData: FormData): Promise<SocialState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const name = String(formData.get("card_name") ?? "").trim();
  if (!name) return fail("Pick a card to add.");

  const rawQty = Number.parseInt(String(formData.get("quantity") ?? "1"), 10);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.min(rawQty, 10000) : 1;

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
    .insert({ user_id: user.id, card_id: cardId, quantity });

  if (error) {
    if (error.code === "23505" || error.message.includes("duplicate key")) {
      return fail(`${name} is already on your want list.`);
    }
    if (error.code === "PGRST205") {
      return fail("The want list is not set up on the database yet — apply migration 00000000000015.");
    }
    return fail(error.message);
  }

  revalidate();
  return ok(`Added ${name} to your want list.`);
}

export async function setWantQuantity(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const id = String(formData.get("want_id") ?? "").trim();
  const quantity = Number.parseInt(String(formData.get("quantity") ?? ""), 10);
  if (!id || !Number.isFinite(quantity) || quantity < 1) return;

  const supabase = await createClient();
  await supabase
    .from("want_list")
    .update({ quantity: Math.min(quantity, 10000) })
    .eq("id", id);

  revalidate();
}

export async function removeWant(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const id = String(formData.get("want_id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("want_list").delete().eq("id", id);

  revalidate();
}
