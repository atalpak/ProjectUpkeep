"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { decideStacking } from "@/lib/collection/stacking";
import { CONDITIONS, FINISHES, type Condition, type Finish } from "@/lib/types";

export type ActionState = {
  error: string | null;
  notice: string | null;
  /**
   * Changes on every successful action. The add form watches this to know when
   * to reset itself — comparing the notice text alone would miss the case where
   * you add the same card twice and get a byte-identical message.
   *
   * Random rather than a counter: server actions can run on a fresh instance
   * each time, so a module-level counter would restart at 1 and collide.
   */
  nonce?: string;
};

export const EMPTY_STATE: ActionState = { error: null, notice: null };

function fail(message: string): ActionState {
  return { error: message, notice: null };
}

function ok(message: string): ActionState {
  return { error: null, notice: message, nonce: crypto.randomUUID() };
}

/** Turns the empty-string a <select> submits for "unsorted" into a real null. */
function optionalId(value: FormDataEntryValue | null): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" ? null : s;
}

function parseQuantity(value: FormDataEntryValue | null): number | null {
  const n = Number.parseInt(String(value ?? "1"), 10);
  if (!Number.isFinite(n) || n < 1 || n > 10_000) return null;
  return n;
}

/**
 * Maps a Postgres error into something a person can act on.
 *
 * The trigger messages from the migrations are precise but written for whoever
 * is reading the schema, not for someone filing cards.
 */
function friendlyDbError(message: string): string {
  if (message.includes("must belong to owner_user_id")) {
    return "That location belongs to a different account.";
  }
  if (message.includes("one level of nesting")) {
    return "Locations can only be nested one level deep.";
  }
  if (message.includes("duplicate key")) {
    return "You already have something with that name there.";
  }
  return message;
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

export async function addCardInstance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const cardId = String(formData.get("card_id") ?? "").trim();
  if (!cardId) return fail("Pick a printing first.");

  const condition = String(formData.get("condition") ?? "NM") as Condition;
  const finish = String(formData.get("finish") ?? "nonfoil") as Finish;
  const language = String(formData.get("language") ?? "en").trim();
  const locationId = optionalId(formData.get("location_id"));
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const quantity = parseQuantity(formData.get("quantity"));
  if (quantity === null) return fail("Quantity must be a whole number between 1 and 10000.");

  if (!CONDITIONS.includes(condition)) return fail("Unknown condition.");
  if (!FINISHES.includes(finish)) return fail("Unknown finish.");

  const supabase = await createClient();

  // Stacking policy — see src/lib/collection/stacking.ts. Look for rows that
  // share this card's stack key, then let the policy module decide.
  const stackQuery = supabase
    .from("card_instances")
    .select("id, quantity, notes")
    .eq("card_id", cardId)
    .eq("condition", condition)
    .eq("finish", finish)
    .eq("language", language);

  // `location_id is null` and `location_id = x` are different operators, and
  // "unsorted" is a real value here, not a missing one.
  const { data: candidates, error: lookupError } =
    locationId === null
      ? await stackQuery.is("location_id", null)
      : await stackQuery.eq("location_id", locationId);

  if (lookupError) return fail(friendlyDbError(lookupError.message));

  const decision = decideStacking(
    { card_id: cardId, condition, finish, language, location_id: locationId, notes, quantity },
    candidates ?? [],
  );

  if (decision.action === "merge") {
    const { error } = await supabase
      .from("card_instances")
      .update({ quantity: decision.newQuantity })
      .eq("id", decision.instanceId);
    if (error) return fail(friendlyDbError(error.message));
  } else {
    const { error } = await supabase.from("card_instances").insert({
      owner_user_id: user.id,
      card_id: cardId,
      location_id: locationId,
      condition,
      finish,
      language,
      quantity,
      notes,
    });
    if (error) return fail(friendlyDbError(error.message));
  }

  revalidatePath("/collection");
  revalidatePath("/locations");

  const name = String(formData.get("card_name") ?? "the card");
  return ok(
    decision.action === "merge"
      ? `Added ${quantity} more ${name} — now ${decision.newQuantity} in that stack.`
      : `Added ${quantity} × ${name}.`,
  );
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export async function updateCardInstance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("instance_id") ?? "").trim();
  if (!id) return fail("Missing card.");

  const condition = String(formData.get("condition") ?? "NM") as Condition;
  const finish = String(formData.get("finish") ?? "nonfoil") as Finish;
  const language = String(formData.get("language") ?? "en").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const quantity = parseQuantity(formData.get("quantity"));
  if (quantity === null) return fail("Quantity must be a whole number between 1 and 10000.");
  if (!CONDITIONS.includes(condition)) return fail("Unknown condition.");
  if (!FINISHES.includes(finish)) return fail("Unknown finish.");

  const supabase = await createClient();

  // No owner filter: RLS restricts this to the user's own rows, and its WITH
  // CHECK clause blocks any attempt to reassign ownership through this path.
  const { error } = await supabase
    .from("card_instances")
    .update({
      condition,
      finish,
      language,
      quantity,
      notes,
      location_id: optionalId(formData.get("location_id")),
    })
    .eq("id", id);

  if (error) return fail(friendlyDbError(error.message));

  revalidatePath("/collection");
  revalidatePath("/locations");
  return ok("Saved.");
}

// ---------------------------------------------------------------------------
// Move — the location half of the product, so it gets its own narrow action
// rather than going through the general edit form.
// ---------------------------------------------------------------------------

export async function moveCardInstance(formData: FormData): Promise<void> {
  const id = String(formData.get("instance_id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("card_instances")
    .update({ location_id: optionalId(formData.get("location_id")) })
    .eq("id", id);

  revalidatePath("/collection");
  revalidatePath("/locations");
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteCardInstance(formData: FormData): Promise<void> {
  const id = String(formData.get("instance_id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("card_instances").delete().eq("id", id);

  revalidatePath("/collection");
  revalidatePath("/locations");
}
