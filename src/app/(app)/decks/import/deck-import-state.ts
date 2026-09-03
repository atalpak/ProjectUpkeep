/**
 * State for the deck-list importer.
 *
 * Kept out of actions.ts because that file carries "use server" and may only
 * export async functions — same split as collection/import/action-state.ts and
 * decks/deck-state.ts.
 */

/** A matched line, as shown in the preview. */
export type DeckImportRow = {
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

export type DeckImportPreview = {
  format: "csv" | "text" | "empty";
  /** Sum of quantities across matched lines. */
  totalCards: number;
  /** Distinct printings that matched. */
  matchedRows: number;
  /** Of those, how many are not yet on the list. */
  newEntries: number;
  /** …and how many already are, so the quantity is added on top. */
  mergedEntries: number;
  rows: DeckImportRow[];
  rowsTruncated: boolean;
  /** Lines that read fine but matched no card. */
  skipped: Array<{ line: number; raw: string; reason: string }>;
  /** Lines that could not be read at all. */
  problems: Array<{ line: number; raw: string; reason: string }>;
};

export type DeckImportState = {
  error: string | null;
  notice: string | null;
  preview: DeckImportPreview | null;
  /** Changes on a successful import, so the form knows not to re-run itself. */
  nonce?: string;
};

export const EMPTY_DECK_IMPORT_STATE: DeckImportState = {
  error: null,
  notice: null,
  preview: null,
};

/** How many matched lines the preview lists before it stops. */
export const DECK_PREVIEW_ROW_LIMIT = 120;
