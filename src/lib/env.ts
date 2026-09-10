/**
 * Environment access with loud failures.
 *
 * A missing Supabase key should stop the process with a sentence that says
 * which variable to set, not surface later as an opaque 401 from PostgREST.
 */

/**
 * Validate an already-resolved value.
 *
 * Every caller reads `process.env.NEXT_PUBLIC_*` as a literal member expression
 * and passes the result in, so the bundler can still see the access statically
 * (hard constraint 2) while the failure stays loud and names the variable.
 *
 * There is deliberately no `required(name)` helper that does the lookup itself:
 * a dynamic `process.env[name]` read is invisible to Next's inliner, and having
 * one in this file at all is an invitation to route a `NEXT_PUBLIC_*` variable
 * through it. Server-only secrets are read in `scripts/`, which is outside the
 * Next build — see `SUPABASE_SERVICE_ROLE_KEY` in `scripts/sync-scryfall.ts`.
 */
function requiredValue(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable ${label}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/**
 * Safe to send to the browser.
 *
 * The two reads below MUST stay as literal `process.env.NEXT_PUBLIC_*` member
 * expressions: Next.js only inlines statically-written references into the Edge
 * and browser bundles, and this runs in Edge middleware. Routing them through
 * the dynamic `required(name)` path yields `undefined` in production and crashes
 * the middleware on every request.
 */
export function publicSupabaseConfig() {
  return {
    url: requiredValue(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_URL",
    ),
    anonKey: requiredValue(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ),
  };
}
