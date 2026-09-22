import { decideReprint, type ReprintIntent, type StackableRow } from '@upkeep/domain';
import type { Condition, Finish } from './types';

/**
 * The reprint-side sibling of writer.ts's stack-addition wrapper and
 * move.ts's stack-move wrapper.
 *
 * Changing which PRINTING an owned copy is has exactly the shape of a move —
 * one row loses copies, another may gain them — except the axis is the
 * printing rather than the box (see migration 39's header, and
 * @upkeep/domain's reprint.ts for the two decisions this module leans on:
 * finish reconciliation, settled by the caller before it ever reaches here,
 * and the merge-vs-insert decision, decided by decideReprint the same way
 * decideStacking decides a plain addition or move).
 *
 * The DESTINATION decision — is there already a matching stack to merge the
 * reprinted copies into — reuses decideReprint from @upkeep/domain unchanged.
 * The source side (an existing row losing quantity, or being updated in
 * place, or split) is verified by the database under a row lock inside
 * apply_stack_reprint itself, not decided here.
 */
export interface StackReprintDraft {
  sourceInstanceId: string;
  newCardId: string;
  /** Settled by reconcileFinish before this module is ever called — a
   *  finish the new printing was never made in is refused by the database. */
  finish: Finish;
  quantity: number;
  condition: Condition;
  language: string;
  locationId: string | null;
  notes: string | null;
}

export interface StackReprintInput {
  operationId: string;
  sourceInstanceId: string;
  newCardId: string;
  finish: Finish;
  quantity: number;
  /** null means the shared stacking policy decided "update/split in place"; non-null means "merge into exactly this row". */
  targetInstanceId: string | null;
}

export interface StackReprintResult {
  instanceId: string;
  quantity: number;
  replayed: boolean;
}

/**
 * Distinguishes "the source copy no longer matches what was decided" from any
 * other failure — matching migration 39's message text the same way
 * move.ts's isStaleSourceError matches migration 38's. A stale source means
 * the picked instance moved, was edited, changed quantity, or stopped being
 * this account's between the decision and the call.
 */
export function isStaleReprintSourceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no longer matches what was decided');
}

/**
 * Distinguishes a stale DESTINATION target — the merge candidate moved, was
 * edited, or stopped being this account's — from a stale source. Both are
 * "no_data_found" at the database level; the message text is what a client
 * can branch on, same as apply_stack_move's two cases.
 */
export function isStaleReprintDestinationTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no longer matches the decided target');
}

export interface ReprintStore {
  /**
   * Rows that could be this reprint's destination stack-mate, for the
   * signed-in user only. The caller's backend must filter this explicitly by
   * owner (see .claude/rules/data-access.md), the same discipline
   * CollectionStore.findCandidates and MoveStore.findDestinationCandidates
   * require — RLS alone would also return a friend's tradable-binder rows
   * sharing this post-reprint stack key, which would merge a correction into
   * a stack that was never this account's.
   */
  findCandidates(key: {
    cardId: string;
    condition: Condition;
    finish: Finish;
    language: string;
    locationId: string | null;
  }): Promise<StackableRow[]>;
  applyStackReprint(input: StackReprintInput): Promise<StackReprintResult>;
}

/**
 * Mobile-parity adapter: decide the destination merge-vs-insert with the
 * shared decideReprint policy, then apply through migration 39's
 * apply_stack_reprint.
 *
 * Retry shape, deliberately asymmetric between the two kinds of staleness —
 * mirroring move.ts's single automatic retry for exactly the situation it can
 * actually resolve, and surfacing everything else:
 *
 *   - A stale DESTINATION target is resolved the same way move.ts resolves
 *     one: re-fetch candidates, re-decide, and retry once with the SAME
 *     operation id. Safe because a failed call rolled back before ever
 *     recording a ledger row, so the retry is the first application, not a
 *     second one.
 *   - A stale SOURCE has nothing to re-decide — the source is an explicit
 *     user pick (which physical stack is being corrected), not a policy
 *     decision this module makes. The one thing worth retrying automatically
 *     is a transient race, so this retries the identical call once, with the
 *     same operation id, and surfaces the error to the caller if it is still
 *     stale on the second attempt.
 */
export function createReprintWriter(store: ReprintStore) {
  async function decideTarget(draft: StackReprintDraft): Promise<string | null> {
    const candidates = await store.findCandidates({
      cardId: draft.newCardId,
      condition: draft.condition,
      finish: draft.finish,
      language: draft.language,
      locationId: draft.locationId,
    });
    const intent: ReprintIntent = {
      sourceInstanceId: draft.sourceInstanceId,
      newCardId: draft.newCardId,
      finish: draft.finish,
      quantity: draft.quantity,
      condition: draft.condition,
      language: draft.language,
      location_id: draft.locationId,
      notes: draft.notes,
    };
    const decision = decideReprint(intent, candidates);
    return decision.action === 'merge' ? decision.instanceId : null;
  }

  return {
    async save({
      operationId,
      draft,
    }: {
      operationId: string;
      draft: StackReprintDraft;
    }): Promise<StackReprintResult> {
      const targetInstanceId = await decideTarget(draft);
      const apply = (target: string | null) =>
        store.applyStackReprint({
          operationId,
          sourceInstanceId: draft.sourceInstanceId,
          newCardId: draft.newCardId,
          finish: draft.finish,
          quantity: draft.quantity,
          targetInstanceId: target,
        });

      let result: StackReprintResult;
      try {
        result = await apply(targetInstanceId);
      } catch (error) {
        if (isStaleReprintDestinationTargetError(error)) {
          // Re-decide the destination and retry exactly once with the same
          // operation id — safe because the failed call rolled back before
          // ever recording a ledger row.
          result = await apply(await decideTarget(draft));
        } else if (isStaleReprintSourceError(error)) {
          // Nothing to re-decide about the source; retry the identical call
          // once, on the chance this was a transient race, and surface it if
          // it is still stale.
          result = await apply(targetInstanceId);
        } else {
          throw error;
        }
      }

      return result;
    },
  };
}
