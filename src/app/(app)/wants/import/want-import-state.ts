/**
 * State for the wish-list importer.
 *
 * Kept out of actions.ts because that file carries "use server" and may only
 * export async functions — same split as collection/import/action-state.ts
 * and decks/import/deck-import-state.ts.
 */

/** A matched line, as shown in the preview. */
export type WantImportRow = {
  line: number;
  quantity: number;
  /** The card's own name once matched, or the raw name if not. */
  name: string;
  /** "Name · SET #123" when matched. */
  matched: string | null;
  setCode: string | null;
  imageUri: string | null;
  cardId: string | null;
};

export type WantImportPreview = {
  format: "csv" | "text" | "empty";
  /** Sum of quantities across matched lines. */
  totalCards: number;
  /** Distinct printings that matched. */
  matchedRows: number;
  /** Of those, how many are not yet on the wish list. */
  newEntries: number;
  /** …and how many already are — skipped, not merged (see actions.ts). */
  alreadyWanted: number;
  rows: WantImportRow[];
  rowsTruncated: boolean;
  /** Lines that read fine but matched no card. */
  skipped: Array<{ line: number; raw: string; reason: string }>;
  /** Lines that could not be read at all. */
  problems: Array<{ line: number; raw: string; reason: string }>;
};

export type WantImportState = {
  error: string | null;
  notice: string | null;
  preview: WantImportPreview | null;
  /** Changes on a successful import, so the form knows not to re-run itself. */
  nonce?: string;
};

export const EMPTY_WANT_IMPORT_STATE: WantImportState = {
  error: null,
  notice: null,
  preview: null,
};

/** How many matched lines the preview lists before it stops. */
export const WANT_IMPORT_PREVIEW_ROW_LIMIT = 120;
