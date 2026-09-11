"use server";

import { redirect } from "next/navigation";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { reauthErrorMessage } from "@/lib/auth/reauth";
import type { SettingsState } from "@/app/(app)/settings/action-state";

/**
 * Account deletion.
 *
 * Kept apart from the three ordinary account forms in actions.ts: this is the
 * one irreversible thing on the settings page, and it needs to fail loudly and
 * separately rather than sharing a "save everything" pattern with a username
 * edit.
 *
 * Two checks gate it, doing two different jobs. The current password is
 * re-verified exactly as updatePassword already does (see
 * src/lib/auth/reauth.ts for why that logic is shared) — that is what stops an
 * unlocked, unattended browser from closing the account; nothing about a valid
 * session proves the person is still at the keyboard. The typed username is
 * then handed to delete_own_account (migration 30), which re-checks it against
 * the stored value itself rather than trusting this form's claim — the
 * function's real authorization gate is auth.uid() (a valid session), and the
 * username check is defense in depth on top of that, the same relationship
 * accept_trade has between its actor check and its ownership checks.
 */

function fail(message: string): SettingsState {
  return { error: message, notice: null };
}

export async function deleteAccount(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");
  // Mirrors updatePassword: no email on the account, nothing to re-auth against.
  if (!user.email) return fail("Your account has no email address to verify against.");

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (username === "") return fail("Type your username to confirm.");
  if (password === "") return fail("Enter your current password.");

  const supabase = await createClient();

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (reauthError) return fail(reauthErrorMessage(reauthError));

  const { error } = await supabase.rpc("delete_own_account", {
    confirm_username: username,
  });

  if (error) {
    // delete_own_account raises a specific, stable message for the one case
    // this form can actually produce (the typed username not matching the
    // signed-in account) — anonymous calls can't reach this action at all,
    // since getCurrentUser already turned those away above.
    if (error.message.includes("does not match")) {
      return fail("That didn't match your username — nothing was deleted.");
    }
    return fail(error.message);
  }

  // The account is gone; there is no session left to hold onto. signOut()
  // clears the local cookie the same way the ordinary sign-out action does.
  await supabase.auth.signOut();
  redirect("/login?deleted=1");
}
