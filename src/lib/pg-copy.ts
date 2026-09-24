/**
 * Encoding rows as Postgres `COPY ... FROM STDIN WITH (FORMAT csv)` lines.
 *
 * Pure text handling, no driver: the loader (scripts/sync-oracle-direct.ts)
 * owns the connection and only asks this module what bytes to send. CSV rather
 * than COPY's default text format because text format's backslash escapes are
 * easy to get subtly wrong for oracle text (newlines, backslashes, tabs all
 * occur), while CSV has exactly one rule: quote the field, double any quote.
 *
 * The distinction COPY CSV draws that this depends on: an UNQUOTED empty field
 * is NULL, a QUOTED empty field ("") is the empty string. So null is written as
 * nothing, and every other value is always quoted, which keeps '' and NULL
 * apart -- Scryfall does send empty oracle_text for vanilla creatures, and that
 * must not become null.
 */

export type CopyValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly string[]
  | Record<string, unknown>;

const quote = (text: string): string =>
  // A NUL cannot be stored in text or jsonb; dropping it beats failing a load.
  `"${text.replaceAll("\u0000", "").replaceAll('"', '""')}"`;

/** `{"a","b"}` -- every element quoted, so commas, braces and spaces need no thought. */
export function pgArrayLiteral(items: readonly string[]): string {
  const escaped = items.map(
    (item) => `"${item.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
  );
  return `{${escaped.join(",")}}`;
}

/** One value as a CSV field. */
export function copyField(value: CopyValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return quote(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot COPY a non-finite number (${value})`);
    return quote(String(value));
  }
  if (typeof value === "boolean") return quote(value ? "t" : "f");
  if (Array.isArray(value)) return quote(pgArrayLiteral(value as readonly string[]));
  return quote(JSON.stringify(value));
}

/** A whole row, newline-terminated. Column order is the caller's. */
export function copyLine(values: readonly CopyValue[]): string {
  return `${values.map(copyField).join(",")}\n`;
}
