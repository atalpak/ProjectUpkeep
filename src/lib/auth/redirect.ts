/**
 * Validates the `next` parameter used to bounce someone back to where they were
 * headed after signing in.
 *
 * Taking that value from the query string unchecked is a textbook open
 * redirect: an attacker sends /login?next=https://evil.example and the app
 * hands the user off after they authenticate. Protocol-relative URLs
 * ("//evil.example") are the case naive checks miss, since they start with a
 * slash but are still absolute.
 */
export const DEFAULT_REDIRECT = "/collection";

/**
 * Control characters and DEL. A newline in a redirect target is a
 * response-splitting attempt, and the rest have no business in a path.
 */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

export function safeRedirect(next: unknown, fallback: string = DEFAULT_REDIRECT): string {
  if (typeof next !== "string") return fallback;

  const value = next.trim();
  if (value === "") return fallback;

  // Must be a site-relative path...
  if (!value.startsWith("/")) return fallback;
  // ...and not protocol-relative.
  if (value.startsWith("//")) return fallback;
  // Backslashes are treated as slashes by some browsers, so "/\evil.example"
  // can behave like a protocol-relative URL.
  if (value.startsWith("/\\")) return fallback;
  if (CONTROL_CHARS.test(value)) return fallback;

  return value;
}
