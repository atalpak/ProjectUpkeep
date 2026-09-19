/**
 * The new-password rules, mirrored from src/lib/auth/password.ts on the web.
 *
 * A local copy on purpose and only until the validators move into
 * packages/upkeep-domain, which both apps can import. Until then the number
 * has to agree with the web (a password you can set here but not restore
 * through the web reset page is a support ticket), so change both together.
 * Kept in its own file with no React or Supabase imports so that move is a
 * cut-and-paste.
 */

/** Minimum length for any password this app accepts. Same as the web. */
export const MIN_PASSWORD_LENGTH = 8;

// One flat shape: this workspace's tsconfig has no strictNullChecks, so a
// union discriminated on `ok` would not narrow. `error` is set iff `ok` is false.
export type PasswordCheck = { ok: boolean; error?: string };

/** Length and (when a confirmation is supplied) match check; first failure wins. */
export function validateNewPassword(password: string, confirmation?: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (confirmation !== undefined && password !== confirmation) {
    return { ok: false, error: 'Those two passwords do not match.' };
  }
  return { ok: true };
}

/** Same pattern the web signup action enforces; the profile trigger relies on it. */
const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;

export function validateUsername(username: string): PasswordCheck {
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'Usernames are 3–32 characters: letters, numbers, underscore or hyphen.' };
  }
  return { ok: true };
}
