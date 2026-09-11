"use client";

import { useActionState } from "react";

import { deleteAccount } from "@/app/(app)/settings/delete-account-actions";
import { EMPTY_SETTINGS_STATE } from "@/app/(app)/settings/action-state";
import { Banner, Button, Field, Input } from "@/components/ui";

/**
 * The one irreversible form on the settings page.
 *
 * Two proofs are demanded before anything happens: the account's own username,
 * typed back rather than clicked past, and the current password, re-verified
 * server-side exactly as changing the password is. See
 * delete-account-actions.ts for why both exist and what each actually guards
 * against — the short version is that they answer different questions ("is
 * this really your account" vs. "are you still the one holding this
 * browser").
 */
export function DeleteAccountForm({ username }: { username: string }) {
  const [state, action, pending] = useActionState(deleteAccount, EMPTY_SETTINGS_STATE);

  return (
    <form action={action} className="space-y-3">
      <Field label={`Type your username (${username}) to confirm`}>
        <Input name="username" autoComplete="off" required />
      </Field>

      <Field label="Current password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      <Banner kind="error">{state.error}</Banner>

      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? "Deleting…" : "Delete my account"}
      </Button>
    </form>
  );
}
