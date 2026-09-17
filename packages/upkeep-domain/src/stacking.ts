/**
 * STACKING POLICY — the single place the `quantity` assumption lives.
 *
 * Originally `src/lib/collection/stacking.ts`, web-only. Phase 3a of the
 * mobile initiative lifts it here so the scanner can apply the exact same
 * merge-or-insert decision the web app's add form, deck actions and bulk
 * import already use — see the architect's impact map for why that is now
 * approved (mobile previously inserted one row per scan on purpose; see
 * `.claude/rules/mobile.md`'s history of that call).
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
 * STACKING_ENABLED to false. Nothing else changes and no migration is needed —
 * including the database side of the new atomic merge function
 * (`apply_stack_addition`, migration 36): its insert branch is what every
 * "merge" decision degrades to once this flag is off, precisely because the
 * decision of *which* branch to take is made here, in application code, and
 * handed to the database as a plain instruction rather than re-decided in SQL.
 * Reimplementing this policy in the database would spend that reversibility.
 *
 * Two copies count as "the same stack" when their printing, condition, finish,
 * language and location all match. Notes deliberately do not participate: a
 * note is about a specific physical card, so a card with a note never merges
 * (see stackKeyFor returning null).
 */

import type { Condition, Finish } from "./vocabulary";

/** Flip to false for one-row-per-physical-card. */
export const STACKING_ENABLED = true;

export type StackKey = {
  card_id: string;
  condition: Condition;
  finish: Finish;
  language: string;
  location_id: string | null;
};

/**
 * The columns `decideStacking` needs off an existing row. Deliberately
 * smaller than either client's own row type (`CardInstance` on the web,
 * `SavedRow` on mobile) — this module has no business knowing about the rest
 * of either shape.
 */
export type StackableRow = {
  id: string;
  quantity: number;
  notes: string | null;
};

export function stackKeyFor(
  input: Pick<StackKey, "card_id" | "condition" | "finish" | "language" | "location_id"> & {
    notes?: string | null;
  },
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
 *
 * `newQuantity` is a display/optimistic-UI hint only, as of migration 36's
 * `apply_stack_addition`. The database function does the actual increment
 * (`quantity = quantity + p_quantity`, atomically, under `for update`), so the
 * number that ends up on the row is whatever the function returns, not this
 * one — two callers can decide against the same stale read and both be told
 * "5", and only the function serialises them into 4 then 6. Callers may still
 * show this value immediately while the request is in flight.
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
  candidates: StackableRow[],
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
