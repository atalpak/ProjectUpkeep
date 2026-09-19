/**
 * The new-password rules, shared by every place a password gets set: signup,
 * the locked-out recovery flow, and the change-password form in settings.
 *
 * Supabase's own floor is 6. Signup raised it to 8, and the other two paths
 * have to agree with that number — a password you can set on signup but not
 * restore through recovery is a support ticket waiting to happen. Keeping the
 * constant here, and interpolating it into the copy rather than hard-coding
 * "8", is what stops the check and the message drifting apart.
 *
 * Strength beyond length is deliberately not judged here: this app leans on
 * Supabase for that, the same way it leans on Scryfall for prices.
 *
 * Lives in @upkeep/domain so the web app and the mobile app cannot disagree on
 * the floor; src/lib/auth/password.ts re-exports it.
 */

/** Minimum length for any password this app accepts. See the header for why 8. */
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordCheck = { ok: true } | { ok: false; error: string };

/**
 * Length and (when a confirmation is supplied) match check for a new password.
 * Returns the first failure as a ready-to-show sentence, or `{ ok: true }`.
 *
 * `confirmation` is optional because signup has a single password field; pass it
 * from any form that has a "confirm" input and the mismatch is caught here
 * instead of in three slightly different call sites.
 */
export function validateNewPassword(
  password: string,
  confirmation?: string,
): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (confirmation !== undefined && password !== confirmation) {
    return { ok: false, error: "Those two passwords do not match." };
  }
  return { ok: true };
}

/**
 * Same pattern the web signup action enforces; the profile trigger relies on
 * it, so a username that passes here and fails there is a failed signup.
 */
const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;

export function validateUsername(username: string): PasswordCheck {
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error: "Usernames are 3\u201332 characters: letters, numbers, underscore or hyphen.",
    };
  }
  return { ok: true };
}
