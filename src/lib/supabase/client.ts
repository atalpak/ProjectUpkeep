"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "@/lib/env";

/**
 * Supabase client for Client Components. Reads the session from cookies written
 * by the server, so it stays in step with the server-side client below.
 *
 * Everything this client does is subject to RLS — it holds the anon key only.
 */
export function createClient() {
  const { url, anonKey } = publicSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
