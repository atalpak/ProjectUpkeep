export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;
export const FINISHES = ['nonfoil', 'foil', 'etched', 'glossy'] as const;
export const LANGUAGES = ['en','es','fr','de','it','pt','ja','ko','ru','zhs','zht','he','la','grc','ar','sa','ph'] as const;
export type Condition = typeof CONDITIONS[number];
export type Finish = typeof FINISHES[number];
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
}
export interface CatalogBundle { schemaVersion: 1; version: string; generatedAt: string; printings: Printing[] }
export interface TextEvidence { lines: string[]; printingLines?: string[] }
export interface Candidate { printing: Printing; score: number; evidence: 'name' | 'printing' | 'image' }
export interface ScanResult { candidates: Candidate[]; method: 'ocr' | 'image' | 'none'; needsReview: true; warnings: string[] }
export interface CollectionDraft {
  card_id: string; condition: Condition; finish: Finish; language: string;
  quantity: number; location_id: string | null; notes: string | null;
}
export interface ConfirmedScan { operationId: string; draft: CollectionDraft }
export interface CollectionWriter { save(scan: ConfirmedScan): Promise<{ id: string }> }
export interface ScanEvent { method: ScanResult['method']; durationMs: number; candidateCount: number; outcome: 'review' | 'no_match' | 'error' }
