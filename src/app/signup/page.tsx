"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signUp, type AuthState } from "@/app/auth/actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Banner, Button, Field, Input } from "@/components/ui";

const INITIAL: AuthState = { error: null, notice: null };

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUp, INITIAL);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <h1 className="text-2xl font-semibold">Create an account</h1>
      <p className="mt-1 mb-6 text-sm text-ink-muted">
        Track where every card actually lives.
      </p>

      <form action={action} className="space-y-4">
        <Field label="Username" hint="Letters, numbers, underscore or hyphen. 3–32 characters.">
          <Input
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_\-]+"
            autoFocus
          />
        </Field>

        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>

        <Field label="Password" hint="At least 8 characters.">
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>

        <Banner kind="error">{state.error}</Banner>
        <Banner kind="success">{state.notice}</Banner>

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        Already have one?{" "}
        <Link href="/login" className="text-accent underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
