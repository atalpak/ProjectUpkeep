import { decideStacking, type StackableRow } from '@upkeep/domain';
import type { CollectionDraft, CollectionWriter, Condition, Finish } from './types';

/**
 * The exact database call this writer makes: apply_stack_addition (migration
 * 36). `targetInstanceId` null means the shared stacking policy
 * (`decideStacking`, from @upkeep/domain) decided "insert"; non-null means
 * "merge into exactly this row", and the database re-verifies that row still
 * matches the stack key before touching it — this store never trusts its own
 * read.
 */
export interface StackAdditionInput {
  operationId: string;
  targetInstanceId: string | null;
  cardId: string;
  condition: Condition;
  finish: Finish;
  language: string;
  locationId: string | null;
  quantity: number;
  notes: string | null;
}

export interface StackAdditionResult {
  instanceId: string;
  quantity: number;
  replayed: boolean;
}

/**
 * A distinguishable "the decided target has gone stale" signal. The database
 * function raises this as a plain Postgres exception (see migration 36's
 * "no longer matches the decided target" message) — Supabase's RPC error
 * carries that message text but no structured field a client can branch on
 * more cleanly, so this checks the message the same way
 * src/app/(app)/collection/actions.ts's friendlyDbError matches on substrings
 * elsewhere in this codebase.
 */
export function isStaleTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no longer matches the decided target');
}

export interface CollectionStore {
  currentUserId(): Promise<string | null>;
  /**
   * Rows that could be this draft's stack-mate, for the signed-in user only.
   * The caller's backend must filter this explicitly by owner (see
   * .claude/rules/data-access.md) — RLS alone would also return a friend's
   * tradable-binder rows that happen to share this stack key, which would
   * make this store merge into a stack that was never this account's to
   * begin with.
   */
  findCandidates(key: {
    cardId: string;
    condition: Condition;
    finish: Finish;
    language: string;
    locationId: string | null;
  }): Promise<StackableRow[]>;
  applyStackAddition(input: StackAdditionInput): Promise<StackAdditionResult>;
}

/**
 * Phase 3a adapter: decide merge-vs-insert with the shared stacking policy,
 * then apply that decision through migration 36's apply_stack_addition,
 * which is what actually makes this safe under a second, independent writer
 * (another device, or a second scan on this one racing a slow response).
 *
 * Two things used to make this file's old design ("append one row per
 * confirmed scan; never read/modify/write shared quantities") the safe
 * choice: no shared counter was ever written, and a lost response was
 * resolved by re-reading the row this call would have inserted, by its own
 * id. Neither holds any more now that a save can merge into a row this call
 * did not create. Safety now comes from two things instead:
 *
 *   1. apply_stack_addition's ledger (collection_write_ops): the same
 *      operationId always resolves to the same recorded result, so a lost
 *      response or an app restart mid-request can retry indefinitely without
 *      ever double-applying.
 *   2. The atomic increment under a row lock inside that same function: two
 *      callers deciding "merge" off the same stale read serialise into two
 *      real increments, not one overwritten total.
 *
 * The one thing this store must still get right on its own is a genuinely
 * stale decision — the target row moved, was edited, or stopped being this
 * account's between the read and the call. The database refuses that
 * (isStaleTargetError), and it is always safe to re-decide and retry once
 * with the SAME operation id: a failed call rolled back, so no ledger row
 * was ever recorded for it.
 */
export function createCollectionWriter(store: CollectionStore): CollectionWriter {
  async function decideTarget(draft: CollectionDraft): Promise<string | null> {
    const candidates = await store.findCandidates({
      cardId: draft.card_id,
      condition: draft.condition,
      finish: draft.finish,
      language: draft.language,
      locationId: draft.location_id,
    });
    const decision = decideStacking(
      {
        card_id: draft.card_id,
        condition: draft.condition,
        finish: draft.finish,
        language: draft.language,
        location_id: draft.location_id,
        notes: draft.notes,
        quantity: draft.quantity,
      },
      candidates,
    );
    return decision.action === 'merge' ? decision.instanceId : null;
  }

  return {
    async save({ operationId, draft }) {
      const owner = await store.currentUserId();
      if (!owner) throw new Error('Sign in to save to your collection.');

      const targetInstanceId = await decideTarget(draft);
      const apply = (target: string | null) =>
        store.applyStackAddition({
          operationId,
          targetInstanceId: target,
          cardId: draft.card_id,
          condition: draft.condition,
          finish: draft.finish,
          language: draft.language,
          locationId: draft.location_id,
          quantity: draft.quantity,
          notes: draft.notes,
        });

      let result: StackAdditionResult;
      try {
        result = await apply(targetInstanceId);
      } catch (error) {
        if (!isStaleTargetError(error)) throw error;
        // Re-fetch candidates, re-decide, and retry exactly once with the
        // same operation id. Safe because a failed call rolled back before
        // ever writing a ledger row, so this is not a second application —
        // it is the first one, just against a freshly re-decided target.
        result = await apply(await decideTarget(draft));
      }

      return { id: result.instanceId, replayed: result.replayed, quantity: result.quantity };
    },
  };
}
