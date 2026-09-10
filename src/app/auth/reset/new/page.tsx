import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";
import { RECOVERY_COOKIE } from "@/lib/auth/recovery";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NewPasswordForm } from "@/components/auth/NewPasswordForm";

/**
 * Never prerendered: the page reads the signed-in user and a request cookie,
 * neither of which exists at build time.
 */
export const dynamic = "force-dynamic";

/**
 * The end of the recovery flow. By the time someone reaches here, /auth/confirm
 * has verified the recovery link and set both a session cookie and the
 * short-lived `pw_recovery` marker.
 *
 * Both are required. The session alone is not enough: `verifyOtp` mints one
 * indistinguishable from an ordinary sign-in, so gating on it only would let any
 * signed-in person open this route and reset their password with no re-auth.
 * The marker proves the session came from the email link. Missing either — link
 * already used, 15-minute window lapsed, or someone just navigated here — sends
 * them back to ask for a fresh link rather than showing a form that can only
 * fail.
 */
export default async function NewPasswordPage() {
  const [user, cookieStore] = await Promise.all([getCurrentUser(), cookies()]);
  if (!user || !cookieStore.get(RECOVERY_COOKIE)) redirect("/auth/reset");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <h1 className="text-2xl font-semibold">Set a new password</h1>
      <p className="mt-1 mb-6 text-sm text-ink-muted">
        Almost done. Choose a new password and you will be signed in.
      </p>

      <NewPasswordForm />
    </main>
  );
}
