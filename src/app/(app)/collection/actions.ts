"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { decideStacking } from "@/lib/collection/stacking";
import { CONDITIONS, FINISHES, type Condition, type Finish } from "@/lib/types";
import type { ActionState } from "@/app/(app)/collection/action-state";

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
  // From migration 36's apply_stack_addition, when the stack it decided to
  // merge into changed shape (moved, was edited, or stopped being this
  // account's) between the page loading and this submit.
  if (message.includes("no longer matches the decided target")) {
    return "That stack changed since this page loaded. Refresh and try again.";
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
  // share this card's stack key, then let the policy module decide. The
  // explicit owner filter matters even though RLS already scopes reads:
  // migration 9 makes a friend's tradable-binder rows genuinely readable, so
  // an unscoped lookup could otherwise offer one of those as a merge
  // candidate. (It would not actually merge into it — apply_stack_addition
  // below re-verifies ownership itself and refuses — but there is no reason
  // to let a friend's card shape this account's decision at all.)
  const stackQuery = supabase
    .from("card_instances")
    .select("id, quantity, notes")
    .eq("owner_user_id", user.id)
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

  // The decision above only picks a branch and, for a merge, a target row and
  // a display estimate (decision.newQuantity — see its comment in
  // src/lib/collection/stacking.ts for why it is a hint now, not the source of
  // truth). The actual write goes through apply_stack_addition (migration 36),
  // which re-verifies the target and performs an atomic increment or insert —
  // this is what makes concurrent adds (this tab, another tab, mobile) safe
  // rather than a last-write-wins race. A fresh operation id per submit is
  // this call's idempotency key, the same role it plays on mobile
  // (packages/scan-core/src/writer.ts).
  const { data, error } = await supabase.rpc("apply_stack_addition", {
    p_operation_id: crypto.randomUUID(),
    p_target_instance_id: decision.action === "merge" ? decision.instanceId : null,
    p_card_id: cardId,
    p_condition: condition,
    p_finish: finish,
    p_language: language,
    p_location_id: locationId,
    p_quantity: quantity,
    p_notes: notes,
  });
  if (error) return fail(friendlyDbError(error.message));

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) return fail("The card could not be saved. Try again.");

  revalidatePath("/collection");
  revalidatePath("/locations");

  const name = String(formData.get("card_name") ?? "the card");
  return ok(
    decision.action === "merge"
      ? `Added ${quantity} more ${name} — now ${result.result_quantity} in that stack.`
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
