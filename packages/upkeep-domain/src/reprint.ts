/**
 * Changing which PRINTING an owned copy is — the decisions that belong in
 * application code rather than in SQL.
 *
 * `apply_stack_reprint` (migration 39) deliberately does not decide whether
 * the corrected copies should merge into an existing stack. It carries out an
 * instruction: a target id means merge, null means do not. That split is what
 * keeps the stacking bet reversible (see `stacking.ts`), so the decision lives
 * here, next to `decideStacking`, and both clients ask the same question.
 *
 * Two decisions, and they are independent:
 *
 *   1. Which finish the copy should have afterwards. A printing that was never
 *      foiled cannot hold a foil copy, and the database refuses one, so the
 *      caller has to settle this BEFORE it writes.
 *   2. Whether the result merges into a stack the account already owns.
 */

import { decideStacking, type StackDecision, type StackableRow } from "./stacking";
import { FINISHES, type Condition, type Finish } from "./vocabulary";

/**
 * What a reprint should do about the copy's finish.
 *
 * `keep` is the ordinary case — the new printing comes in the finish the copy
 * already is, so nothing is asked of anyone.
 *
 * `choose` is the owner's "warn and force a choice" rule: the printing exists,
 * it is a legitimate thing to own, but it was never made in this copy's
 * current finish. The caller must put the options in front of the user rather
 * than silently picking one, and rather than hiding the printing — a nonfoil-
 * only reprint of a card you own in foil is still the printing you are holding.
 *
 * `impossible` means the printing records no finishes at all. That is a data
 * gap in the card catalogue, not a user decision, so it reads differently.
 */
export type FinishReconciliation =
  | { kind: "keep"; finish: Finish }
  | { kind: "choose"; from: Finish; options: Finish[] }
  | { kind: "impossible"; from: Finish };

/** Only the finishes this app actually understands, in the app's own order. */
function knownFinishes(available: readonly string[] | null | undefined): Finish[] {
  const offered = new Set(available ?? []);
  return FINISHES.filter((f) => offered.has(f));
}

/**
 * Given the finish a copy is now and the finishes the new printing was made
 * in, say whether the reprint can go ahead unchanged.
 *
 * Note this reads `available_finishes` off the `cards` row rather than
 * inferring anything: the same column `apply_stack_reprint` checks, so the UI
 * and the database cannot disagree about what is possible.
 */
export function reconcileFinish(
  current: Finish,
  available: readonly string[] | null | undefined,
): FinishReconciliation {
  const options = knownFinishes(available);
  if (options.length === 0) return { kind: "impossible", from: current };
  if (options.includes(current)) return { kind: "keep", finish: current };
  return { kind: "choose", from: current, options };
}

/** The stack attributes a reprint does NOT change, plus the two it does. */
export type ReprintIntent = {
  /** The copy being corrected. */
  sourceInstanceId: string;
  /** The printing it turns out to be. */
  newCardId: string;
  /** The finish it will have afterwards — settled by `reconcileFinish` first. */
  finish: Finish;
  /** How many copies of the stack are being corrected. */
  quantity: number;
  condition: Condition;
  language: string;
  location_id: string | null;
  notes: string | null;
};

/**
 * Whether the corrected copies land in a stack that already exists.
 *
 * `candidates` is every row already matching the POST-reprint stack key for
 * this account — the new card id and finish, the copy's existing condition,
 * language and location. Query it with an explicit owner filter: migration 9
 * makes a friend's tradable-binder rows genuinely readable, and there is no
 * reason to let a friend's card shape this account's decision.
 *
 * The source row is excluded here rather than in every caller's query. It can
 * legitimately come back as a candidate — correcting 2 of a 5-stack to a
 * printing it already is would match itself — and `apply_stack_reprint`
 * refuses a self-merge outright, so a caller that passed it would get an error
 * instead of the insert it actually wanted.
 */
export function decideReprint(
  intent: ReprintIntent,
  candidates: StackableRow[],
): StackDecision {
  return decideStacking(
    {
      card_id: intent.newCardId,
      condition: intent.condition,
      finish: intent.finish,
      language: intent.language,
      location_id: intent.location_id,
      notes: intent.notes,
      quantity: intent.quantity,
    },
    candidates.filter((c) => c.id !== intent.sourceInstanceId),
  );
}

/**
 * Whether a printing is the same card as another, by the rule the rest of the
 * app uses: oracle id when both sides have one, the name when either does not.
 *
 * Duplicated deliberately in SQL inside `apply_stack_reprint`, so a second
 * client cannot bypass it. This copy is what lets the UI refuse early, with a
 * sentence rather than a database exception.
 */
export function isSameCard(
  a: { oracle_id?: string | null; name: string },
  b: { oracle_id?: string | null; name: string },
): boolean {
  if (a.oracle_id && b.oracle_id) return a.oracle_id === b.oracle_id;
  return a.name.toLowerCase() === b.name.toLowerCase();
}
