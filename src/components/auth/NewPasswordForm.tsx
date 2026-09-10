"use client";

import { useActionState } from "react";

import { setNewPassword, type AuthState } from "@/app/auth/actions";
import { Banner, Button, Field, Input } from "@/components/ui";

/**
 * The set-a-new-password form, split out of the page because the page is a
 * server component that gates on the recovery session. On success the action
 * redirects, so there is no success banner to show here.
 */
const INITIAL: AuthState = { error: null, notice: null };

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(setNewPassword, INITIAL);

  return (
    <form action={action} className="space-y-4">
      <Field label="New password" hint="At least 8 characters.">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
        />
      </Field>

      <Field label="Confirm new password">
        <Input
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      <Banner kind="error">{state.error}</Banner>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
