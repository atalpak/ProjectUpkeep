/**
 * State for the import form.
 *
 * Kept out of actions.ts because that file carries "use server" and may only
 * export async functions — see the sibling collection/action-state.ts.
 */

export type ImportRowView = {
  line: number;
  quantity: number;
  /** Name as written in the file. */
  name: string;
  /** What we matched it to, already formatted for display. */
  matched: string | null;
  imageUri: string | null;
  /** The matched printing, so the row can feed the card panel on hover. */
  cardId: string | null;
  condition: string;
  finish: string;
  language: string;
  warnings: string[];
};

export type ImportIssue = { line: number; raw: string; reason: string };

export type ImportPreview = {
  /** How the input was read, so a mis-detection is visible rather than silent. */
  format: "csv" | "text" | "empty";
  /** For a CSV, which of its columns we understood. */
  mappedColumns: Record<string, string>;
  /** Physical cards that will be written. */
  totalCards: number;
  /** File lines that will be written. */
  matchedRows: number;
  /** card_instances rows that will be created or bumped. */
  stackCount: number;
  /** Stacks that land as a brand-new collection entry. */
  newEntries: number;
  /**
   * Stacks that add quantity to an entry already in the collection. When this
   * is the whole import and `newEntries` is 0, the run is almost certainly a
   * re-import of an earlier export — which doubles quantities rather than being
   * a no-op. The preview warns on it.
   */
  mergedEntries: number;
  /** A capped sample for the table; `matchedRows` is the true count. */
  rows: ImportRowView[];
  rowsTruncated: boolean;
  /** Lines that will not be imported, with the reason. */
  skipped: ImportIssue[];
  /** Lines the parser could not read at all. */
  problems: ImportIssue[];
  /** How many matched rows carry a caveat. */
  warningCount: number;
};

export type ImportState = {
  error: string | null;
  notice: string | null;
  preview: ImportPreview | null;
  /** Changes on every successful commit, so the form knows to reset. */
  nonce?: string;
};

export const EMPTY_IMPORT_STATE: ImportState = {
  error: null,
  notice: null,
  preview: null,
};

/** Rows rendered in the preview table. The rest are summarised by count. */
export const PREVIEW_ROW_LIMIT = 200;

/** Bytes of pasted text or uploaded file we will accept. */
export const MAX_INPUT_BYTES = 2_000_000;
