"use client";

import { useActionState } from "react";

import {
  updateEmail,
  updatePassword,
  updateUsername,
} from "@/app/(app)/settings/actions";
import { EMPTY_SETTINGS_STATE } from "@/app/(app)/settings/action-state";
import { Banner, Button, Field, Input } from "@/components/ui";

/**
 * The three account forms.
 *
 * One component per thing that can change, each with its own submit and its own
 * banner, so a failed password change never clears a successful username one.
 */

export function UsernameForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState(updateUsername, EMPTY_SETTINGS_STATE);

  return (
    <form action={action} className="space-y-3">
      <Field
        label="Username"
        hint="How friends find you. 3–32 characters: letters, numbers, underscore or hyphen."
      >
        <Input
          name="username"
          defaultValue={current}
          maxLength={32}
          autoComplete="username"
          required
        />
      </Field>

      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save username"}
      </Button>
    </form>
  );
}

export function EmailForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState(updateEmail, EMPTY_SETTINGS_STATE);

  return (
    <form action={action} className="space-y-3">
      <Field
        label="Email"
        hint="Used to sign in. Changing it sends a confirmation link to the new address; nothing moves until you follow it."
      >
        <Input
          name="email"
          type="email"
          defaultValue={current}
          autoComplete="email"
          required
        />
      </Field>

      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Sending…" : "Change email"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, EMPTY_SETTINGS_STATE);

  return (
    // Keyed on the success nonce so both fields empty themselves after a
    // successful change rather than leaving a password sitting in the DOM.
    <form key={state.nonce ?? "initial"} action={action} className="space-y-3">
      <Field label="New password" hint="At least 8 characters.">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
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
      <Banner kind="success">{state.notice}</Banner>

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
