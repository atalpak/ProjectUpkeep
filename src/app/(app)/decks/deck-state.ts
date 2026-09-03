/**
 * State for the deck forms.
 *
 * Kept out of actions.ts because that file carries "use server" and may only
 * export async functions — see collection/action-state.ts.
 */

export type DeckState = {
  error: string | null;
  notice: string | null;
  /** Changes on every success, so a form knows to reset itself. */
  nonce?: string;
};

export const EMPTY_DECK_STATE: DeckState = { error: null, notice: null };
