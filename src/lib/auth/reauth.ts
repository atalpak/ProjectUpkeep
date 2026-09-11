/**
 * Turns a `signInWithPassword` re-auth failure into the sentence a form shows.
 *
 * Two places prove the person at the keyboard still knows the current
 * password before doing something irreversible-ish: changing it
 * (`updatePassword` in settings/actions.ts) and, now, deleting the account
 * (`deleteAccount` in settings/delete-account-actions.ts). Both need the same
 * distinction in what they say: a re-auth attempt shares Supabase's sign-in
 * rate limit, so a run of wrong guesses starts coming back as 429 rather than
 * an auth failure, and a rate-limited person should be told to wait, not that
 * their password is wrong — they may have typed it correctly. Keeping that
 * split here is what stops the two call sites drifting into different wording
 * for the same failure.
 *
 * The Supabase client itself is not called from here: `signInWithPassword` has
 * a side effect (it refreshes the session), and that belongs at the call site
 * where the rest of the action's control flow lives. This only classifies
 * whatever error came back.
 */

/** The subset of Supabase's AuthError this cares about. */
export type ReauthError = {
  status?: number;
  code?: string;
};

export function reauthErrorMessage(error: ReauthError): string {
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "Too many attempts — wait a minute and try again.";
  }
  return "That current password isn't right.";
}
