"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  decideReprint,
  decideStacking,
  isSameCard,
  reconcileFinish,
} from "@/lib/collection/stacking";
import { applyStackRekey, type StackRekeyStep } from "@/lib/collection/rekey";
import { CONDITIONS, FINISH_LABELS, FINISHES, type Condition, type Finish } from "@/lib/types";
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
  // From migration 39's apply_stack_reprint. The copy moved, was edited or
  // changed quantity between this page loading and the submit — the same
  // stale-read failure as above, from the other side of the operation.
  if (message.includes("no longer matches what was decided")) {
    return "That copy changed since this page loaded. Refresh and try again.";
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
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const id = String(formData.get("instance_id") ?? "").trim();
  if (!id) return fail("Missing card.");

  const condition = String(formData.get("condition") ?? "NM") as Condition;
  const finish = String(formData.get("finish") ?? "nonfoil") as Finish;
  const language = String(formData.get("language") ?? "en").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const locationId = optionalId(formData.get("location_id"));

  const quantity = parseQuantity(formData.get("quantity"));
  if (quantity === null) return fail("Quantity must be a whole number between 1 and 10000.");
  if (!CONDITIONS.includes(condition)) return fail("Unknown condition.");
  if (!FINISHES.includes(finish)) return fail("Unknown finish.");

  const supabase = await createClient();

  // The copy as it stands. Owner-scoped explicitly for the reason
  // .claude/rules/data-access.md gives: migration 9 makes a friend's tradable
  // binder genuinely readable, so an unscoped read by id is not "my row".
  const { data: source, error: sourceError } = await supabase
    .from("card_instances")
    .select("id, card_id, condition, finish, language, location_id, notes, quantity")
    .eq("id", id)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (sourceError) return fail(friendlyDbError(sourceError.message));
  if (!source) return fail("That copy is no longer in your collection.");

  // The edit form's "quantity" has always meant "this stack now holds N", not
  // "move N copies" — and it can be edited alongside condition/finish/
  // language/location in the same save. Two ordered steps through
  // apply_stack_rekey (migration 41) resolve that the same way the reprint
  // feature already resolves the identical ambiguity: set the absolute
  // quantity first, then re-file the whole (now correctly-sized) pile.
  const steps: StackRekeyStep[] = [
    { mode: "set_quantity", source_instance_id: id, quantity },
  ];

  const attrsChanged =
    condition !== source.condition ||
    finish !== source.finish ||
    language !== source.language ||
    locationId !== source.location_id ||
    notes !== source.notes;

  if (attrsChanged) {
    // Rows that already match the POST-save stack key, excluding this row
    // itself — it can legitimately match its own new key, and
    // apply_stack_rekey refuses a self-merge. Owner-scoped for the same
    // reason addCardInstance's lookup is.
    const candidateQuery = supabase
      .from("card_instances")
      .select("id, quantity, notes")
      .eq("owner_user_id", user.id)
      .eq("card_id", source.card_id)
      .eq("condition", condition)
      .eq("finish", finish)
      .eq("language", language);

    const { data: candidates, error: lookupError } =
      locationId === null
        ? await candidateQuery.is("location_id", null)
        : await candidateQuery.eq("location_id", locationId);

    if (lookupError) return fail(friendlyDbError(lookupError.message));

    const decision = decideStacking(
      { card_id: source.card_id, condition, finish, language, location_id: locationId, notes, quantity },
      (candidates ?? []).filter((c) => c.id !== id),
    );

    steps.push({
      mode: "rekey",
      source_instance_id: id,
      quantity,
      condition,
      finish,
      language,
      location_id: locationId,
      notes,
      target_instance_id: decision.action === "merge" ? decision.instanceId : null,
    });
  }

  const { error } = await applyStackRekey(supabase, steps);
  if (error) return fail(friendlyDbError(error));

  revalidatePath("/collection");
  revalidatePath("/locations");
  return ok("Saved.");
}

// ---------------------------------------------------------------------------
// Reprint — changing WHICH PRINTING a copy you already own is.
//
// Its own action rather than a field on the edit form above, deliberately. The
// edit form submits condition, finish, language, location, quantity and notes
// as one intent; folding printing into that would let a single Save change the
// printing AND the quantity AND the location together, and "quantity" means
// "set this stack to N" on that form while it means "move N copies" in every
// atomic stack function. One action, one intent — see the owner decision
// recorded in apps/mobile/docs/BACKLOG.md under roadmap item 6.
// ---------------------------------------------------------------------------

export async function reprintCardInstance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const instanceId = String(formData.get("instance_id") ?? "").trim();
  if (!instanceId) return fail("Missing card.");

  const newCardId = String(formData.get("card_id") ?? "").trim();
  if (!newCardId) return fail("Pick a printing first.");

  const finish = String(formData.get("finish") ?? "").trim() as Finish;
  if (!FINISHES.includes(finish)) return fail("Unknown finish.");

  const supabase = await createClient();

  // The copy as it stands. Owner-scoped explicitly for the reason
  // .claude/rules/data-access.md gives: migration 9 makes a friend's tradable
  // binder genuinely readable, so an unscoped read by id is not "my row".
  const { data: source, error: sourceError } = await supabase
    .from("card_instances")
    .select("id, card_id, condition, finish, language, location_id, notes, quantity")
    .eq("id", instanceId)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (sourceError) return fail(friendlyDbError(sourceError.message));
  if (!source) return fail("That copy is no longer in your collection.");

  const quantity = parseQuantity(formData.get("quantity") ?? String(source.quantity));
  if (quantity === null) return fail("Quantity must be a whole number between 1 and 10000.");
  if (quantity > source.quantity) {
    return fail(`You only have ${source.quantity} of that copy.`);
  }

  // Both printings, for the same-card rule and the finish check. `cards` is
  // read-only reference data, so no owner filter applies here.
  const { data: printings, error: cardsError } = await supabase
    .from("cards")
    .select("scryfall_id, oracle_id, name, set_name, set_code, collector_number, available_finishes")
    .in("scryfall_id", [source.card_id, newCardId]);

  if (cardsError) return fail(friendlyDbError(cardsError.message));

  const from = printings?.find((c) => c.scryfall_id === source.card_id);
  const to = printings?.find((c) => c.scryfall_id === newCardId);
  if (!to) return fail("That printing is not in the card database.");
  if (!from) return fail("This copy's current printing is missing from the card database.");

  if (source.card_id === newCardId && source.finish === finish) {
    return fail("That is already this copy's printing.");
  }

  // Refused here so the user gets a sentence rather than a database exception.
  // apply_stack_reprint enforces the same rule itself, so this is a courtesy,
  // not the guard — a second client cannot get around it.
  if (!isSameCard(from, to)) {
    return fail(`${to.name} is a different card, not another printing of ${from.name}.`);
  }

  // The finish has to be settled before the write: the database refuses a
  // finish the printing was never made in, per the owner's "warn and force a
  // choice" rule.
  const reconciliation = reconcileFinish(source.finish as Finish, to.available_finishes);
  if (reconciliation.kind === "impossible") {
    return fail(`The card database lists no finishes for ${to.set_name ?? to.set_code}, so this copy cannot be moved to it.`);
  }
  if (!to.available_finishes?.includes(finish)) {
    return fail(`That printing does not come in ${FINISH_LABELS[finish]}.`);
  }
  // A forced choice that came back unchanged means the form skipped the
  // warning rather than answering it.
  if (reconciliation.kind === "choose" && finish === reconciliation.from) {
    return fail(`That printing does not come in ${FINISH_LABELS[finish]}. Pick a finish it was made in.`);
  }

  // Rows that already match the POST-reprint stack key. Owner-scoped for the
  // same reason addCardInstance's lookup is, and `location_id is null` is a
  // different operator from `= x` because Unsorted is a real value.
  const candidateQuery = supabase
    .from("card_instances")
    .select("id, quantity, notes")
    .eq("owner_user_id", user.id)
    .eq("card_id", newCardId)
    .eq("condition", source.condition)
    .eq("finish", finish)
    .eq("language", source.language);

  const { data: candidates, error: lookupError } =
    source.location_id === null
      ? await candidateQuery.is("location_id", null)
      : await candidateQuery.eq("location_id", source.location_id);

  if (lookupError) return fail(friendlyDbError(lookupError.message));

  // decideReprint drops the source row from the candidates itself: it can
  // legitimately match its own post-reprint key, and apply_stack_reprint
  // refuses a self-merge.
  const decision = decideReprint(
    {
      sourceInstanceId: source.id,
      newCardId,
      finish,
      quantity,
      condition: source.condition as Condition,
      language: source.language,
      location_id: source.location_id,
      notes: source.notes,
    },
    candidates ?? [],
  );

  // The write. Ordering, the open-trade block and the same-card rule are all
  // enforced inside the function (migration 39); a fresh operation id per
  // submit is this call's idempotency key.
  const { data, error } = await supabase.rpc("apply_stack_reprint", {
    p_operation_id: crypto.randomUUID(),
    p_instance_id: source.id,
    p_new_card_id: newCardId,
    p_finish: finish,
    p_target_instance_id: decision.action === "merge" ? decision.instanceId : null,
    p_quantity: quantity,
  });
  if (error) return fail(friendlyDbError(error.message));

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) return fail("The printing could not be changed. Try again.");

  revalidatePath("/collection");
  revalidatePath("/locations");
  // A reprinted copy that was sleeved changes what a deck's physical contents
  // view shows, even though the deck's LIST deliberately does not follow it.
  revalidatePath("/decks");

  const where = to.set_name ?? to.set_code.toUpperCase();
  const finishNote = finish === source.finish ? "" : ` as ${FINISH_LABELS[finish]}`;
  return ok(
    decision.action === "merge"
      ? `Changed ${quantity} × ${to.name} to ${where} #${to.collector_number}${finishNote} — merged into a stack you already had, now ${result.result_quantity}.`
      : `Changed ${quantity} × ${to.name} to ${where} #${to.collector_number}${finishNote}.`,
  );
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
