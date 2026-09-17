import { decideStacking, type StackableRow } from '@upkeep/domain';
import type { Condition, Finish } from './types';

/**
 * The move-side sibling of writer.ts's stack-addition wrapper.
 *
 * Sleeving a card into a deck, or unsleeving one back out, is a MOVE: an
 * existing physical copy changes location_id, and the total owned must not
 * change. The database call this drives is apply_stack_move (migration 38),
 * apply_stack_addition's sibling for that shape — see that migration's header
 * for why a move needs its own atomic function rather than reusing the
 * addition one (a lost decrement here can destroy a copy that was already
 * owned, not just fail to record a new one).
 *
 * The DESTINATION decision — is there already a matching stack to merge into
 * at the destination, or does this need a fresh row — reuses decideStacking
 * from @upkeep/domain unchanged. Nothing about "does an existing stack match"
 * is different for a move than for an addition; only the source side (an
 * existing row losing quantity, verified by the database under a row lock) is
 * new, and that lives entirely in apply_stack_move itself, not in policy code.
 */
export interface StackMoveDraft {
  sourceInstanceId: string;
  cardId: string;
  condition: Condition;
  finish: Finish;
  language: string;
  quantity: number;
  /** null means the destination is Unsorted — a real, decided value, not "no destination chosen". */
  destinationLocationId: string | null;
}

export interface StackMoveInput {
  operationId: string;
  sourceInstanceId: string;
  quantity: number;
  destinationLocationId: string | null;
  /** null means the shared stacking policy decided "insert a fresh row"; non-null means "merge into exactly this row". */
  destinationTargetInstanceId: string | null;
}

export interface StackMoveResult {
  instanceId: string;
  quantity: number;
  replayed: boolean;
}

/**
 * Distinguishes "the source copy no longer matches what was decided" from any
 * other failure — matching migration 38's message text the same way
 * writer.ts's isStaleTargetError matches migration 36's. A stale source means
 * the picked instance moved, was edited, dropped below the requested
 * quantity, or stopped being this account's between the decision and the
 * call.
 */
export function isStaleSourceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no longer matches what was decided');
}

/**
 * Distinguishes a stale DESTINATION target — the merge candidate moved, was
 * edited, or stopped being this account's — from a stale source. Both are
 * "no_data_found" at the database level; the message text is what a client
 * can branch on, same as apply_stack_addition's single stale-target case.
 */
export function isStaleDestinationTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no longer matches the decided target');
}

export interface MoveStore {
  /**
   * Rows that could be this move's destination stack-mate, for the signed-in
   * user only. The caller's backend must filter this explicitly by owner (see
   * .claude/rules/data-access.md) for the same reason CollectionStore's
   * findCandidates must in writer.ts — RLS alone would also return a friend's
   * tradable-binder rows sharing this stack key, which would merge a move
   * into a stack that was never this account's.
   */
  findDestinationCandidates(key: {
    cardId: string;
    condition: Condition;
    finish: Finish;
    language: string;
    locationId: string | null;
  }): Promise<StackableRow[]>;
  applyStackMove(input: StackMoveInput): Promise<StackMoveResult>;
}

/**
 * Phase 4b/4c adapter: decide the destination merge-vs-insert with the shared
 * stacking policy, then apply through migration 38's apply_stack_move.
 *
 * Retry shape, deliberately asymmetric between the two kinds of staleness —
 * mirroring writer.ts's single automatic retry for exactly the situation it
 * can actually resolve, and surfacing everything else:
 *
 *   - A stale DESTINATION target is resolved the same way writer.ts resolves
 *     one: re-fetch destination candidates, re-decide, and retry once with
 *     the SAME operation id. Safe because a failed call rolled back before
 *     ever recording a ledger row, so the retry is the first application, not
 *     a second one.
 *   - A stale SOURCE has nothing to re-decide — the source is an explicit
 *     user pick (which physical stack to sleeve/unsleeve), not a policy
 *     decision this module makes. The one thing worth retrying automatically
 *     is a transient race (a concurrent move on this exact row settling a
 *     moment before this one), so this retries the identical call once, with
 *     the same operation id, and surfaces the error to the caller if it is
 *     still stale on the second attempt — "stale-source retry-once-then-
 *     surface", per the phase's own spec.
 */
export function createMoveWriter(store: MoveStore) {
  async function decideDestinationTarget(draft: StackMoveDraft): Promise<string | null> {
    const candidates = await store.findDestinationCandidates({
      cardId: draft.cardId,
      condition: draft.condition,
      finish: draft.finish,
      language: draft.language,
      locationId: draft.destinationLocationId,
    });
    const decision = decideStacking(
      {
        card_id: draft.cardId,
        condition: draft.condition,
        finish: draft.finish,
        language: draft.language,
        location_id: draft.destinationLocationId,
        notes: null,
        quantity: draft.quantity,
      },
      candidates,
    );
    return decision.action === 'merge' ? decision.instanceId : null;
  }

  return {
    async move({
      operationId,
      draft,
    }: {
      operationId: string;
      draft: StackMoveDraft;
    }): Promise<StackMoveResult> {
      const destinationTargetInstanceId = await decideDestinationTarget(draft);
      const apply = (target: string | null) =>
        store.applyStackMove({
          operationId,
          sourceInstanceId: draft.sourceInstanceId,
          quantity: draft.quantity,
          destinationLocationId: draft.destinationLocationId,
          destinationTargetInstanceId: target,
        });

      let result: StackMoveResult;
      try {
        result = await apply(destinationTargetInstanceId);
      } catch (destinationError) {
        if (isStaleDestinationTargetError(destinationError)) {
          // Re-decide the destination and retry exactly once with the same
          // operation id — safe because the failed call rolled back before
          // ever recording a ledger row.
          result = await apply(await decideDestinationTarget(draft));
        } else if (isStaleSourceError(destinationError)) {
          // Nothing to re-decide about the source; retry the identical call
          // once, on the chance this was a transient race, and surface it if
          // it is still stale.
          result = await apply(destinationTargetInstanceId);
        } else {
          throw destinationError;
        }
      }

      return result;
    },
  };
}
