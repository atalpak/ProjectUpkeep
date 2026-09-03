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
  const next = useSearchParams().get("next") ?? "";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

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
        Welcome back to MTGManager.
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
    </main>
  );
}
