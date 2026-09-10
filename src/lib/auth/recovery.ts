/**
 * The short-lived marker that says "this session was just minted by clicking a
 * password-reset link in email", as opposed to an ordinary sign-in.
 *
 * `verifyOtp({ type: "recovery" })` (and `exchangeCodeForSession` on a recovery
 * link) returns a session byte-for-byte identical to a normal one. Without a
 * separate signal, any already-signed-in person could open /auth/reset/new and
 * set a new password with no re-auth — the same account-takeover this flow
 * closes elsewhere. This cookie is that signal: httpOnly so page scripts can't
 * forge it, scoped to /auth so it never rides along with ordinary requests, and
 * short-lived so a stale one is not a standing key. /auth/confirm is the only
 * writer, and only on its recovery branch.
 *
 * Defence in depth worth turning on alongside this: Supabase Auth → "Secure
 * password change" makes `updateUser({ password })` itself require recent
 * authentication, which would still hold if this cookie logic ever regressed.
 */

/** Cookie name. Its presence is the whole signal; the value carries nothing. */
export const RECOVERY_COOKIE = "pw_recovery";

/** 15 minutes: long enough to choose a password, short enough not to linger. */
export const RECOVERY_COOKIE_MAX_AGE = 60 * 15;

/**
 * Attributes for both setting and clearing the marker. `secure` is off outside
 * production so the flow still works over plain-HTTP localhost; `path` is why a
 * clear has to name it explicitly.
 */
export function recoveryCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/auth",
    maxAge: RECOVERY_COOKIE_MAX_AGE,
  };
}

/**
 * Where a recovery email link asks to land. `requestPasswordReset` points
 * recovery links — and only those — here, which is what lets the PKCE (`?code=`)
 * branch of /auth/confirm, where there is no `type` param to read, tell a
 * recovery exchange from a signup one.
 */
export const RECOVERY_NEXT = "/auth/reset/new";

export function isRecoveryNext(next: string | null | undefined): boolean {
  return next === RECOVERY_NEXT;
}
