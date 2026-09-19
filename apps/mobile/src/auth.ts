/**
 * Account flows for the app: sign in, create account, forgot password, delete
 * account. Everything goes through the anon-key client in backend.ts, as the
 * signed-in user -- the same rule as the web app (CLAUDE.md constraint 4).
 *
 * Each function returns a ready-to-show message instead of throwing, so the
 * screens stay free of error-shape handling.
 */
import { backend } from './backend';
import { errorMessage } from './errors';
import { validateNewPassword, validateUsername } from '@upkeep/domain';

// Both are read as literal `process.env.EXPO_PUBLIC_*` member expressions --
// see mobile.md; the dynamic form is not inlined into the bundle.

/**
 * Where the web app lives, for the reset-email redirect and the legal pages.
 * The fallback is the production Vercel deployment; set EXPO_PUBLIC_WEB_URL
 * when the app gets a custom domain or to test against a preview.
 */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL?.trim() || 'https://project-upkeep.vercel.app').replace(/\/+$/, '');

/**
 * Whether sign-up demands an invite code. Off by default, matching the web,
 * where signup is open unless SIGNUP_INVITE_CODE is set.
 */
export const SIGNUP_INVITE_REQUIRED = ['1', 'true', 'on', 'yes'].includes(
  (process.env.EXPO_PUBLIC_SIGNUP_INVITE_REQUIRED ?? '').trim().toLowerCase(),
);

/** Same landing the web's requestPasswordReset uses: /auth/confirm, then the new-password form. */
const RESET_REDIRECT = `${WEB_URL}/auth/confirm?next=/auth/reset/new`;

export const PRIVACY_URL = `${WEB_URL}/privacy`;
export const TERMS_URL = `${WEB_URL}/terms`;

// A union on `ok` so a failure always carries its message: this workspace is
// `strict`, so callers narrow with `if (!result.ok)` and `result.error` is a string.
export type AuthResult = { ok: true; notice?: string } | { ok: false; error: string };

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!backend) return { ok: false, error: 'This build is not connected to Upkeep.' };
  if (!email.trim() || !password) return { ok: false, error: 'Enter your email and password.' };
  const { error } = await backend.auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return { ok: true };
  if (/email not confirmed/i.test(error.message)) {
    return { ok: false, error: 'Confirm your email first: open the link we sent you, then sign in.' };
  }
  // Deliberately vague, like the web: "no such account" vs "wrong password"
  // would tell a stranger which emails are registered. Network failures are
  // the exception, since blaming the password for them is just wrong.
  if (/network|fetch|timeout/i.test(error.message)) {
    return { ok: false, error: 'Could not reach Upkeep. Check your connection and try again.' };
  }
  return { ok: false, error: 'That email and password don’t match an account.' };
}

export async function signUpWithPassword(input: {
  email: string; username: string; password: string; confirm: string; invite: string;
}): Promise<AuthResult> {
  if (!backend) return { ok: false, error: 'This build is not connected to Upkeep.' };
  const email = input.email.trim();
  const username = input.username.trim();
  const invite = input.invite.trim();
  if (!email || !input.password || !username || (SIGNUP_INVITE_REQUIRED && !invite)) {
    return { ok: false, error: 'Fill in every field.' };
  }
  const nameCheck = validateUsername(username);
  // `in` narrows the shared union.
  if ('error' in nameCheck) return { ok: false, error: nameCheck.error };
  const pwCheck = validateNewPassword(input.password, input.confirm);
  if ('error' in pwCheck) return { ok: false, error: pwCheck.error };

  // TODO(invite): the web checks the code inside its Next server action against
  // the server-only SIGNUP_INVITE_CODE, and there is no endpoint the app can
  // call for that. Until one exists the code only rides along as user metadata
  // so it is recorded; it is NOT enforced here. Do not treat the flag as a
  // security gate, and do not turn it on in production expecting one.
  const data: Record<string, string> = { username };
  if (invite) data.invite_code = invite;

  const { data: result, error } = await backend.auth.signUp({ email, password: input.password, options: { data } });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      return { ok: false, error: 'An account with that email already exists. Try signing in instead.' };
    }
    return { ok: false, error: errorMessage(error) };
  }
  // With email confirmation on there is a user but no session; the auth state
  // listener signs a confirmed one straight in.
  if (!result.session) return { ok: true, notice: `Check ${email} for a confirmation link, then sign in.` };
  return { ok: true };
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!backend) return { ok: false, error: 'This build is not connected to Upkeep.' };
  if (!email.trim()) return { ok: false, error: 'Enter your email.' };
  const { error } = await backend.auth.resetPasswordForEmail(email.trim(), { redirectTo: RESET_REDIRECT });
  // A rate limit or network error is worth showing; an unknown address is not
  // an error to Supabase, so the answer below never reveals who is registered.
  if (error && /rate|limit|network|fetch/i.test(error.message)) {
    return { ok: false, error: 'Could not send that email just now. Wait a moment and try again.' };
  }
  return { ok: true, notice: 'If an account exists for that address, a reset link is on its way. Open it on the web to choose a new password.' };
}

/**
 * Delete the signed-in account via `delete_own_account` (migration 30), which
 * wants the account's exact username -- the "type DELETE" step is UI-only, so
 * the username is read from the profile here rather than asked for twice.
 * Signs out locally afterwards: the server session died with the user, so a
 * global sign-out would just fail. The catalog and device preferences are
 * not touched.
 */
export async function deleteOwnAccount(userId: string): Promise<AuthResult> {
  if (!backend) return { ok: false, error: 'This build is not connected to Upkeep.' };
  const { data: profile, error: readError } = await backend.from('profiles').select('username').eq('id', userId).maybeSingle();
  if (readError || !profile?.username) return { ok: false, error: 'Could not load your account to delete it. Try again.' };
  const { error } = await backend.rpc('delete_own_account', { confirm_username: profile.username });
  if (error) return { ok: false, error: errorMessage(error) };
  // The account is already gone; a failed local sign-out must not read as a failed delete.
  try { await backend.auth.signOut({ scope: 'local' }); } catch { /* the session is dead server-side either way */ }
  return { ok: true };
}
