"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signUp, type AuthState } from "@/app/auth/actions";
import { Banner, Button, Field, Input } from "@/components/ui";

const INITIAL: AuthState = { error: null, notice: null };

/**
 * The signup form, split out of the page so the page can stay a server
 * component and decide — from `process.env.SIGNUP_INVITE_CODE`, read once at
 * render — whether the invite field appears at all. Mirrors
 * `NewPasswordForm` next to `/auth/reset/new/page.tsx`.
 *
 * `inviteRequired` only changes which field gets `autoFocus` and whether the
 * invite field renders/`required`s; the actual gate is enforced server-side in
 * `signUp`, which reads the same env var independently.
 */
export function SignupForm({ inviteRequired }: { inviteRequired: boolean }) {
  const [state, action, pending] = useActionState(signUp, INITIAL);

  return (
    <>
      <form action={action} className="space-y-4">
        {inviteRequired && (
          <Field
            label="Invite code"
            hint="You need an invite from someone already using Project Upkeep."
          >
            <Input name="invite" autoComplete="off" required autoFocus />
          </Field>
        )}

        <Field label="Username" hint="Letters, numbers, underscore or hyphen. 3–32 characters.">
          <Input
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_\-]+"
            autoFocus={!inviteRequired}
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
    </>
  );
}
