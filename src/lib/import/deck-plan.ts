/**
 * Thin re-export — the pure logic moved to `packages/upkeep-domain` so mobile
 * can share it (same pattern as `src/lib/collection/stacking.ts`). Kept so
 * existing web imports and `scripts/*.test.ts` are unchanged. The reasoning
 * lives in the shared module's header.
 */

export {
  type DeckImportLine,
  type DeckImportPlan,
  planDeckImport,
  splitAgainstDeck,
} from "@upkeep/domain";
