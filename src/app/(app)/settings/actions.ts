"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { validateNewPassword } from "@/lib/auth/password";
import { reauthErrorMessage } from "@/lib/auth/reauth";
import type { SettingsState } from "@/app/(app)/settings/action-state";
import { AVATAR_STYLES, FAVORITE_COLORS, FAVORITE_FORMATS } from "@/lib/social/profile";

/**
 * Account maintenance.
 *
 * Three things a person needs to be able to change about themselves: the name
 * others find them by, the address they sign in with, and the password. Each is
 * a separate form and a separate action, because they fail for entirely
 * different reasons and a combined "save everything" would have to explain
 * which part of it went wrong.
 *
 * Identity lives in Supabase Auth, so the email and password changes go through
 * `auth.updateUser` rather than touching a table. The username is ours, and the
 * constraints on it are in migration 2 — this layer turns those into sentences
 * rather than restating them.
 */

function fail(message: string): SettingsState {
  return { error: message, notice: null };
}

function ok(message: string): SettingsState {
  return { error: null, notice: message, nonce: crypto.randomUUID() };
}

// ---------------------------------------------------------------------------
// Username
// ---------------------------------------------------------------------------

/** Mirrors the CHECK constraints on profiles, so the message arrives before the error. */
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

export async function updateUsername(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const username = String(formData.get("username") ?? "").trim();
  if (username === "") return fail("Pick a username.");
  if (!USERNAME_PATTERN.test(username)) {
    return fail(
      "Usernames are 3–32 characters, letters, numbers, underscore or hyphen only.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ username })
    .eq("id", user.id);

  if (error) {
    // The unique index is on lower(username), so this fires on a case-variant
    // of someone else's handle too.
    if (error.code === "23505" || error.message.includes("duplicate key")) {
      return fail("That username is taken.");
    }
    if (error.message.includes("profiles_username_format")) {
      return fail("Letters, numbers, underscore and hyphen only.");
    }
    if (error.message.includes("profiles_username_length")) {
      return fail("Usernames are 3–32 characters.");
    }
    return fail(error.message);
  }

  // The name appears in the header, on trades and on friend requests.
  revalidatePath("/", "layout");
  return ok("Username updated.");
}

// ---------------------------------------------------------------------------
// Member profile
// ---------------------------------------------------------------------------

export async function updateProfileDetails(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const bio = String(formData.get("bio") ?? "").trim();
  const avatar = String(formData.get("avatar_style") ?? "slate");
  const formats = [...new Set(formData.getAll("favorite_formats").map(String))];
  const colors = [...new Set(formData.getAll("favorite_colors").map(String))];
  const featuredDeckIds = [...new Set(formData.getAll("featured_deck_ids").map((value) => String(value).trim()))];

  if (bio.length > 160) return fail("Keep your bio to 160 characters or fewer.");
  if (!AVATAR_STYLES.some((style) => style === avatar)) return fail("Choose an avatar color.");
  if (formats.length > 3 || formats.some((format) => !FAVORITE_FORMATS.some((choice) => choice === format))) {
    return fail("Choose up to three listed formats.");
  }
  if (colors.length > 5 || colors.some((color) => !FAVORITE_COLORS.some((choice) => choice === color))) {
    return fail("Choose colors from the five mana colors.");
  }
  if (featuredDeckIds.length > 5 || featuredDeckIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return fail("Choose up to five shared decks.");
  }

  const supabase = await createClient();
  if (featuredDeckIds.length > 0) {
    const { data: decks, error: deckError } = await supabase
      .from("locations")
      .select("id")
      .in("id", featuredDeckIds)
      .eq("user_id", user.id)
      .eq("type", "deck")
      .eq("is_public", true);
    if (deckError || decks?.length !== featuredDeckIds.length) {
      return fail("Every featured deck must be yours and shared with friends.");
    }
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .update({
      bio,
      avatar_style: avatar,
      favorite_formats: formats,
      favorite_colors: colors,
      featured_deck_ids: featuredDeckIds,
      pinned_deck_id: featuredDeckIds[0] ?? null,
    })
    .eq("id", user.id)
    .select("username")
    .single();

  if (error) {
    if (error.message.includes("featured_deck_ids")) return fail("Featured decks need database migration 53 before they can be saved.");
    return fail(error.message);
  }
  revalidatePath("/settings");
  revalidatePath(`/u/${encodeURIComponent(profile.username)}`);
  return ok("Profile updated.");
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export async function updateEmail(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const email = String(formData.get("email") ?? "").trim();
  if (email === "") return fail("Enter an email address.");
  if (email.toLowerCase() === (user.email ?? "").toLowerCase()) {
    return fail("That is already your email address.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });

  if (error) return fail(error.message);

  // Nothing has changed yet: Supabase sends a confirmation link and the address
  // only moves once it is followed. Saying so is the difference between a
  // person waiting for an email and one wondering why it did not work.
  return ok(`Check ${email} for a link to confirm the change.`);
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export async function updatePassword(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");
  // The re-auth below signs in by email; an account without one has no current
  // password to prove and can't take this path.
  if (!user.email) return fail("Your account has no email address to verify against.");

  const currentPassword = String(formData.get("current_password") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirm_password") ?? "");

  if (currentPassword === "") return fail("Enter your current password.");

  const passwordCheck = validateNewPassword(password, confirmation);
  if (!passwordCheck.ok) return fail(passwordCheck.error);

  const supabase = await createClient();

  // Prove the person at the keyboard knows the current password before letting
  // them change it — otherwise an unlocked, unattended browser is a one-click
  // account takeover. signInWithPassword refreshes the session as a side
  // effect, which is harmless here: it is the same user re-authenticating as
  // themselves, and the cookie that comes back is equivalent to the one already
  // set.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) return fail(reauthErrorMessage(reauthError));

  const { error } = await supabase.auth.updateUser({ password });

  if (error) return fail(error.message);

  return ok("Password changed.");
}
