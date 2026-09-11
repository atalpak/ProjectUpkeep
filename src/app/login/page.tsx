"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

import { signIn, type AuthState } from "@/app/auth/actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Banner, Button, Field, Input } from "@/components/ui";

const INITIAL: AuthState = { error: null, notice: null };

function LoginForm() {
  const [state, action, pending] = useActionState(signIn, INITIAL);
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  // Set by deleteAccount's post-deletion redirect (settings/delete-account-actions.ts).
  // Reusing the `next` param's existing useSearchParams()+Suspense plumbing rather
  // than adding a second mechanism for one more query param.
  const justDeleted = params.get("deleted") === "1";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      {justDeleted ? (
        <Banner kind="success">Your account has been deleted. Take care.</Banner>
      ) : null}

      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>

      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      <Banner kind="error">{state.error}</Banner>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-ink-muted">
        Welcome back to Project Upkeep.
      </p>

      {/* useSearchParams needs a Suspense boundary to keep the page static. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>

      <p className="mt-6 text-sm text-ink-muted">
        No account?{" "}
        <Link href="/signup" className="text-accent underline">
          Create one
        </Link>
      </p>

      <p className="mt-2 text-sm text-ink-muted">
        <Link href="/auth/reset" className="text-accent underline">
          Forgot your password?
        </Link>
      </p>
    </main>
  );
}
