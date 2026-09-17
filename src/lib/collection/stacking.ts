/**
 * STACKING POLICY — thin re-export.
 *
 * The policy itself moved to `packages/upkeep-domain/src/stacking.ts` in
 * Phase 3a of the mobile initiative, so the scanner can apply the same
 * merge-or-insert decision the web app already made here. This file stays so
 * the four existing web call sites (`src/app/(app)/collection/actions.ts`,
 * `src/app/(app)/decks/actions.ts` — two places — and `src/lib/import/commit.ts`)
 * and `scripts/stacking.test.ts` keep importing from
 * `@/lib/collection/stacking` unchanged. See the shared module's header for
 * the actual reasoning — the "why" belongs there now, not duplicated here.
 */

export {
  STACKING_ENABLED,
  stackKeyFor,
  sameStack,
  decideStacking,
  type StackKey,
  type StackableRow,
  type StackDecision,
} from "@upkeep/domain";
