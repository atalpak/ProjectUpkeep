"use client";

import { useActionState } from "react";
import Link from "next/link";

import { requestPasswordReset, type AuthState } from "@/app/auth/actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Banner, Button, Field, Input } from "@/components/ui";

/**
 * Ask for a reset link. Mirrors the shape of the login and signup pages: a
 * single client form driven by a server action, one banner for the result.
 *
 * The success banner is deliberately the same whether or not the address is
 * registered — see `requestPasswordReset` — so this page can't be used to
 * enumerate accounts.
 */
const INITIAL: AuthState = { error: null, notice: null };

export default function ResetRequestPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, INITIAL);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 mb-6 text-sm text-ink-muted">
        Enter your email and we will send a link to set a new one.
      </p>

      <form action={action} className="space-y-4">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>

        <Banner kind="error">{state.error}</Banner>
        <Banner kind="success">{state.notice}</Banner>

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        Remembered it?{" "}
        <Link href="/login" className="text-accent underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
