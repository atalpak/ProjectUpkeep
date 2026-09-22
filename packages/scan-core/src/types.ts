// Condition, finish and the language code list are shared with the web app
// via @upkeep/domain (Phase 3a of the mobile initiative) — this file used to
// carry its own copy of all three; that copy is now the shared package's job.
export { CONDITIONS, FINISHES, LANGUAGE_CODES as LANGUAGES, type Condition, type Finish, type LanguageCode } from '@upkeep/domain';
import type { Condition, Finish, LanguageCode } from '@upkeep/domain';
export interface Printing {
  /** Exact Upkeep public.cards.id (Scryfall printing UUID), never oracle_id. */
  id: string;
  oracleId: string;
  name: string;
  aliases: string[];
  setCode: string;
  collectorNumber: string;
  finishes: Finish[];
  language: string;
  imageUri?: string;
  /**
   * Added for the printing picker (mobile-app initiative phase 5): a raw set
   * code like "sta" is not something most people recognise, and a search
   * with 100+ printings needs to be legible when grouped or labelled by set.
   * Optional and additive — `schemaVersion` stays 1, so an older bundle that
   * omits these is still valid and the app degrades to showing the set code.
   */
  setName?: string;
  releasedAt?: string;
  rarity?: string;
}
export interface CatalogBundle { schemaVersion: 1; version: string; generatedAt: string; printings: Printing[] }
export interface TextEvidence { lines: string[]; printingLines?: string[] }
export interface Candidate { printing: Printing; score: number; evidence: 'name' | 'printing' | 'image' }
/**
 * `languageHint`, added for backlog item 8 step 4, is the footer's own
 * printed-language token (`printingHints`'s `language`), carried out of
 * `matchEvidence` alongside the printing match so a caller can prefer it over
 * a stale remembered default without this type owning any policy about WHEN
 * that should win -- see ScanScreen's precedence comment for that call.
 */
export interface ScanResult { candidates: Candidate[]; method: 'ocr' | 'image' | 'none'; needsReview: true; warnings: string[]; languageHint?: LanguageCode }
export interface CollectionDraft {
  card_id: string; condition: Condition; finish: Finish; language: string;
  quantity: number; location_id: string | null; notes: string | null;
}
export interface ConfirmedScan { operationId: string; draft: CollectionDraft }
/**
 * `replayed` and `quantity` were added in Phase 3a of the mobile initiative,
 * alongside migration 36's apply_stack_addition: a save can now genuinely
 * merge into an existing stack, so the caller needs to know the resulting
 * quantity (not assume 1) and whether this call actually did anything or
 * just returned a previously-recorded result.
 */
export interface CollectionWriter { save(scan: ConfirmedScan): Promise<{ id: string; replayed: boolean; quantity: number }> }
export interface ScanEvent { method: ScanResult['method']; durationMs: number; candidateCount: number; outcome: 'review' | 'no_match' | 'error' }
