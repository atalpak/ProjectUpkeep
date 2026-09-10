"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/auth/redirect";
import { validateNewPassword } from "@/lib/auth/password";
import { RECOVERY_COOKIE } from "@/lib/auth/recovery";

export type AuthState = { error: string | null; notice: string | null };

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password.", notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately vague: distinguishing "no such account" from "wrong
    // password" tells an attacker which emails are registered.
    return { error: "That email and password don't match an account.", notice: null };
  }

  revalidatePath("/", "layout");
  redirect(safeRedirect(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const username = String(formData.get("username") ?? "").trim();

  if (!email || !password || !username) {
    return { error: "Fill in every field.", notice: null };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      error: "Usernames are 3–32 characters, letters, numbers, underscore or hyphen.",
      notice: null,
    };
  }

  const passwordCheck = validateNewPassword(password);
  if (!passwordCheck.ok) return { error: passwordCheck.error, notice: null };

  const supabase = await createClient();

  // `username` rides along in user metadata; the handle_new_user trigger in
  // migration 0002 reads it to create the profile row.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) {
    return { error: error.message, notice: null };
  }

  // With email confirmation enabled, signUp returns a user but no session.
  if (!data.session) {
    return {
      error: null,
      notice: `Check ${email} for a confirmation link, then sign in.`,
    };
  }

  revalidatePath("/", "layout");
  redirect("/collection");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Step one of a locked-out recovery: mail a reset link.
 *
 * The link points at /auth/confirm — the same handler that lands signup
 * confirmations — with `next=/auth/reset/new`, so after it exchanges the token
 * for a session the person arrives on the set-a-new-password form already
 * signed in.
 *
 * That handler accepts both link styles, so either dashboard configuration
 * works: the default "Reset Password" template (a `?code=…` PKCE link) needs no
 * edit, and the token-hash style works if the template is changed to mirror
 * "Confirm signup" — `{{ .TokenHash }}` + `type=recovery` +
 * `next=/auth/reset/new`. See the doc-comment in auth/confirm/route.ts.
 */
export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Enter your email.", notice: null };
  }

  // Supabase needs an absolute URL to bounce back to. A server action is a
  // same-origin POST, so the Origin header is always set; the Host is a
  // belt-and-braces fallback.
  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ?? `https://${requestHeaders.get("host") ?? ""}`;

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/auth/reset/new`,
  });

  // One answer whether or not that address has an account. Supabase already
  // doesn't error on an unknown email, but the guarantee we care about is that
  // this form can't be used to find out who is registered — the same
  // deliberate vagueness as `signIn` above — so the result isn't inspected.
  return {
    error: null,
    notice: "If an account exists for that address, a reset link is on its way.",
  };
}

/**
 * Step two: set the new password.
 *
 * Two things have to be true. There has to be a session (`/auth/confirm`
 * established one from the recovery link), and the `pw_recovery` cookie that the
 * same handler set has to be present. The cookie is the part that matters:
 * `verifyOtp` mints a session indistinguishable from an ordinary sign-in, so
 * without the marker any signed-in person could reach this action and change
 * their password with no re-auth. Its absence means the link was never followed
 * or the 15-minute window lapsed — either way, start over.
 *
 * On success the marker is spent, so a tab left open on the form can't be
 * replayed later. Enabling Supabase Auth → "Secure password change" would make
 * `updateUser({ password })` itself demand recent auth, and is worth doing as
 * defence in depth. See `src/lib/auth/recovery.ts`.
 */
export async function setNewPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirm_password") ?? "");

  if (!password || !confirmation) {
    return { error: "Fill in every field.", notice: null };
  }

  const passwordCheck = validateNewPassword(password, confirmation);
  if (!passwordCheck.ok) return { error: passwordCheck.error, notice: null };

  const cookieStore = await cookies();
  if (!cookieStore.get(RECOVERY_COOKIE)) {
    return {
      error: "Start a new password reset — this link has expired.",
      notice: null,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message, notice: null };
  }

  cookieStore.delete({ name: RECOVERY_COOKIE, path: "/auth" });

  revalidatePath("/", "layout");
  redirect("/collection");
}
