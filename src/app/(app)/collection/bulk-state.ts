/**
 * State for the bulk-action bar.
 *
 * Kept out of bulk-actions.ts because that file carries "use server" and may
 * only export async functions — see collection/action-state.ts.
 */

export type BulkState = {
  error: string | null;
  notice: string | null;
  /** Changes on every success, so the table knows to clear its selection. */
  nonce?: string;
};

export const EMPTY_BULK_STATE: BulkState = { error: null, notice: null };

/** Guards a single request from carrying an unreasonable number of ids. */
export const MAX_BULK_IDS = 5000;
