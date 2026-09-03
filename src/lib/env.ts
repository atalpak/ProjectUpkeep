/**
 * Environment access with loud failures.
 *
 * A missing Supabase key should stop the process with a sentence that says
 * which variable to set, not surface later as an opaque 401 from PostgREST.
 */

function required(name: string): string {
  const value = process.env[name];
  return requiredValue(value, name);
}

/**
 * Validate an already-resolved value. Split out from `required` so callers that
 * must be statically analyzable by the bundler can read
 * `process.env.NEXT_PUBLIC_*` as a literal member expression and still get the
 * same loud, specific failure.
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

/**
 * Server-only. Bypasses RLS, so this must never be imported into anything that
 * ends up in a client bundle. Only the Scryfall sync job uses it.
 */
export function serviceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}
