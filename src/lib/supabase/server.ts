import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "@/lib/env";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * Acts as the signed-in user (anon key + their session cookie), so RLS applies
 * exactly as it does in the browser. There is no privileged path through here
 * by design: the only thing in this codebase that bypasses RLS is the Scryfall
 * sync job, which runs outside the web app entirely.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = publicSupabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is fine: middleware
          // refreshes the session on every request, so the write here is only
          // ever a redundant refresh.
        }
      },
    },
  });
}

/**
 * The signed-in user, or null. Uses getUser() rather than getSession() — the
 * former revalidates the JWT with Supabase, the latter trusts a cookie the
 * browser could have tampered with.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
