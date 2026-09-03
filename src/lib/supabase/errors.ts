/**
 * Classifying "this column does not exist yet" errors.
 *
 * A migration that has not been applied to a given database shows up as a
 * missing column, but which error code carries that depends on the path:
 *
 * - `42703` is Postgres's own code for a raw SELECT naming an unknown column.
 * - `PGRST204` is PostgREST's code for the insert/update path — it validates
 *   against its schema cache rather than letting Postgres reject the query,
 *   so a write hits this one, not `42703`, even though the underlying cause
 *   is identical.
 *
 * A caller on the write path (insert/update) will only ever see `PGRST204`,
 * but checking both costs nothing and keeps this usable from either path
 * without the caller having to know which one applies.
 */
export function isMissingColumnError(code: string | null | undefined): boolean {
  return code === "PGRST204" || code === "42703";
}
