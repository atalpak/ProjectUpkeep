/**
 * Environment access with loud failures.
 *
 * A missing Supabase key should stop the process with a sentence that says
 * which variable to set, not surface later as an opaque 401 from PostgREST.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/** Safe to send to the browser. */
export function publicSupabaseConfig() {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

/**
 * Server-only. Bypasses RLS, so this must never be imported into anything that
 * ends up in a client bundle. Only the Scryfall sync job uses it.
 */
export function serviceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}
