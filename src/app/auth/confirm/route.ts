import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/auth/redirect";
import {
  RECOVERY_COOKIE,
  isRecoveryNext,
  recoveryCookieOptions,
} from "@/lib/auth/recovery";

/**
 * Landing point for the one-time email links Supabase sends: the signup
 * confirmation and the password-recovery link.
 *
 * Two link styles reach here, and which one you get depends on the dashboard
 * email template, so the handler accepts both:
 *
 *  - **token-hash** (`?token_hash=…&type=recovery&next=/auth/reset/new`) — what
 *    the "Confirm signup" template already uses. The "Reset Password" template
 *    has to be edited to match it: body link `{{ .SiteURL }}/auth/confirm?
 *    token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset/new`. Verified
 *    with `verifyOtp`, which reads `type`.
 *  - **code / PKCE** (`?code=…`) — what the *default* "Reset Password" template
 *    produces with no edits. There is no `type` param on this style, so a
 *    recovery is told apart from a signup by where the link asks to land
 *    (`next === "/auth/reset/new"`, which only `requestPasswordReset` sets).
 *    Exchanged with `exchangeCodeForSession`.
 *
 * On a recovery — and only then — a short-lived `pw_recovery` cookie is set on
 * the redirect. /auth/reset/new and `setNewPassword` require it, so a session
 * minted any other way can't be used to change a password without re-auth. See
 * `src/lib/auth/recovery.ts`. Turning on Supabase Auth → "Secure password
 * change" is the recommended belt-and-braces on top of this.
 *
 * `next` is always run through `safeRedirect` so a crafted link can't turn this
 * handler into an open redirect. A stale or already-used link bounces to /login
 * with a message rather than surfacing a raw error.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeRedirect(searchParams.get("next"), "/collection");

  // token-hash style first — it carries an explicit `type`.
  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return recoveryAware(request, next, type === "recovery");
    }
  } else if (code) {
    // PKCE style: no `type`, so infer recovery from the redirect target.
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return recoveryAware(request, next, isRecoveryNext(next));
    }
  }

  const failed = new URL("/login", request.url);
  failed.searchParams.set("error", "That confirmation link is invalid or has expired.");
  return NextResponse.redirect(failed);
}

/** Redirect to `next`, attaching the recovery marker when this was a recovery. */
function recoveryAware(request: NextRequest, next: string, isRecovery: boolean) {
  const response = NextResponse.redirect(new URL(next, request.url));
  if (isRecovery) {
    response.cookies.set(
      RECOVERY_COOKIE,
      "1",
      recoveryCookieOptions(process.env.NODE_ENV === "production"),
    );
  }
  return response;
}
