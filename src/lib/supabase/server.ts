import { cache } from "react";
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
 *
 * Wrapped in React's `cache` so one request builds one client rather than a
 * dozen. Each call was re-reading the cookie store and constructing a fresh
 * client; sharing one within a request is correct because they would all be
 * bound to the same cookies anyway.
 */
export const createClient = cache(async () => {
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
});

/**
 * The signed-in user, or null. Uses getUser() rather than getSession() — the
 * former revalidates the JWT with Supabase, the latter trusts a cookie the
 * browser could have tampered with.
 *
 * That revalidation is a network round trip to Supabase Auth, and this function
 * is called from almost every query helper in the app — a single page render
 * reached it five or more times (the proxy, the layout, the unread badge, the
 * page, and each helper it calls), each one waiting on its own request. That
 * was a fixed ~300ms floor under every page in the app, regardless of what the
 * page actually did.
 *
 * `cache` collapses them into one call per request. The security property is
 * unchanged: the JWT is still validated with Supabase on every request, just
 * once rather than repeatedly, and the cache lives and dies with the request so
 * nothing is shared between users.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
