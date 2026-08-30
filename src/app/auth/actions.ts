"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/auth/redirect";

export type AuthState = { error: string | null; notice: string | null };

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password.", notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately vague: distinguishing "no such account" from "wrong
    // password" tells an attacker which emails are registered.
    return { error: "That email and password don't match an account.", notice: null };
  }

  revalidatePath("/", "layout");
  redirect(safeRedirect(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const username = String(formData.get("username") ?? "").trim();

  if (!email || !password || !username) {
    return { error: "Fill in every field.", notice: null };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      error: "Usernames are 3–32 characters, letters, numbers, underscore or hyphen.",
      notice: null,
    };
  }
  if (password.length < 8) {
    return { error: "Use a password of at least 8 characters.", notice: null };
  }

  const supabase = await createClient();

  // `username` rides along in user metadata; the handle_new_user trigger in
  // migration 0002 reads it to create the profile row.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) {
    return { error: error.message, notice: null };
  }

  // With email confirmation enabled, signUp returns a user but no session.
  if (!data.session) {
    return {
      error: null,
      notice: `Check ${email} for a confirmation link, then sign in.`,
    };
  }

  revalidatePath("/", "layout");
  redirect("/collection");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
