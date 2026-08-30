/**
 * STACKING POLICY — the single place the `quantity` assumption lives.
 *
 * The data model gives card_instances a `quantity` so that 40 identical bulk
 * commons are one row rather than forty. Phase 0 was skipped, so whether people
 * actually think that way is a guess, and the brief is explicit that guesses
 * must not be hardcoded deep into business logic.
 *
 * So: the database does NOT enforce stacking (there is deliberately no unique
 * constraint on the stack key — see the card_instances migration). Every add,
 * edit and move in the app routes its decision through this module. Switching
 * the product to strict one-row-per-physical-card is done by flipping
 * STACKING_ENABLED to false. Nothing else changes and no migration is needed.
 *
 * Two copies count as "the same stack" when their printing, condition, finish,
 * language and location all match. Notes deliberately do not participate: a
 * note is about a specific physical card, so a card with a note never merges
 * (see stackKeyFor returning null).
 */

import type { CardInstance, Condition, Finish } from "@/lib/types";

/** Flip to false for one-row-per-physical-card. */
export const STACKING_ENABLED = true;

export type StackKey = {
  card_id: string;
  condition: Condition;
  finish: Finish;
  language: string;
  location_id: string | null;
};

export function stackKeyFor(
  input: Pick<
    CardInstance,
    "card_id" | "condition" | "finish" | "language" | "location_id"
  > & { notes?: string | null },
): StackKey | null {
  if (!STACKING_ENABLED) return null;
  // A card someone bothered to annotate is a specific physical card.
  if (input.notes && input.notes.trim().length > 0) return null;

  return {
    card_id: input.card_id,
    condition: input.condition,
    finish: input.finish,
    language: input.language,
    location_id: input.location_id,
  };
}

export function sameStack(a: StackKey, b: StackKey): boolean {
  return (
    a.card_id === b.card_id &&
    a.condition === b.condition &&
    a.finish === b.finish &&
    a.language === b.language &&
    a.location_id === b.location_id
  );
}

/**
 * What the caller should do with an incoming addition.
 *
 * `merge` carries the id of the row to bump and its resulting quantity, so the
 * caller does one targeted update rather than a read-modify-write it has to
 * reason about.
 */
export type StackDecision =
  | { action: "insert" }
  | { action: "merge"; instanceId: string; newQuantity: number };

/**
 * Given the rows that already match an incoming card's stack key, decide
 * whether to merge into one or insert a new row.
 *
 * `candidates` should be the result of querying card_instances on the stack key
 * for the current user. When stacking is off this always returns "insert", so
 * callers need no branching of their own.
 */
export function decideStacking(
  incoming: Parameters<typeof stackKeyFor>[0] & { quantity: number },
  candidates: Array<Pick<CardInstance, "id" | "quantity" | "notes">>,
): StackDecision {
  const key = stackKeyFor(incoming);
  if (!key) return { action: "insert" };

  // Only merge into a row that is itself un-annotated, for the same reason
  // annotated incoming cards do not merge.
  const target = candidates.find((c) => !c.notes || c.notes.trim().length === 0);
  if (!target) return { action: "insert" };

  return {
    action: "merge",
    instanceId: target.id,
    newQuantity: target.quantity + incoming.quantity,
  };
}
