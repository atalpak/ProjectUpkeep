/**
 * State shared by the social forms.
 *
 * Kept out of any "use server" file, which may only export async functions —
 * see collection/action-state.ts for the bug that taught us this.
 */

export type SocialState = {
  error: string | null;
  notice: string | null;
  /** Changes on every success, so a form knows to reset itself. */
  nonce?: string;
};

export const EMPTY_SOCIAL_STATE: SocialState = { error: null, notice: null };
