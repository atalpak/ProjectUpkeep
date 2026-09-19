/**
 * The pure half of committing an import: how the preview is summarised, and how
 * a list of stacks is written one by one and reported back.
 *
 * Kept out of the mobile screen so the rules that matter are testable with
 * node's runner: a failed stack must not stop the rest being tried (one bad
 * row should not strand four hundred good ones), but a run of consecutive
 * failures means the problem is the connection or the sign-in, not the row, so
 * it stops rather than grinding through the whole file to report the same
 * error hundreds of times.
 *
 * The saver is injected. On mobile it is the scan-core collection writer, which
 * is idempotent per operation id — so a caller that keeps each item's
 * `operationId` stable and calls `commitStacks` again with only the failures
 * cannot double-add a stack whose first attempt actually landed.
 */

import type { ImportPlan } from "./import-plan";

export type PlanSummary = {
  /** Physical cards that will be added. */
  cards: number;
  /** Distinct stacks (database writes) after identical rows are combined. */
  stacks: number;
  /** File lines that will not be imported: unknown names, no usable printing. */
  needAttention: number;
  /** File lines that will import, but with a caveat the reader should see. */
  withWarnings: number;
};

export function summarizePlan(plan: ImportPlan): PlanSummary {
  return {
    cards: plan.totalCards,
    stacks: plan.stacks.length,
    needAttention: plan.skippedRows.length,
    withWarnings: plan.rows.filter((r) => r.card && r.warnings.length > 0).length,
  };
}

export type CommitItem = { operationId: string };

export type CommitFailure<T> = { item: T; error: string };

export type CommitOutcome<T> = {
  succeeded: T[];
  failed: CommitFailure<T>[];
  /** Items never tried because the run gave up early. They are retryable too. */
  untried: T[];
};

/** Consecutive failures after which the run stops trying further items. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export async function commitStacks<T extends CommitItem>(
  items: T[],
  save: (item: T) => Promise<void>,
  options: {
    onProgress?: (done: number, total: number) => void;
    describeError?: (error: unknown) => string;
    maxConsecutiveFailures?: number;
  } = {},
): Promise<CommitOutcome<T>> {
  const limit = options.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES;
  const describe =
    options.describeError ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const outcome: CommitOutcome<T> = { succeeded: [], failed: [], untried: [] };
  let streak = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (streak >= limit) {
      outcome.untried.push(item);
      continue;
    }
    try {
      await save(item);
      outcome.succeeded.push(item);
      streak = 0;
    } catch (e) {
      outcome.failed.push({ item, error: describe(e) });
      streak += 1;
    }
    options.onProgress?.(i + 1, items.length);
  }
  return outcome;
}
