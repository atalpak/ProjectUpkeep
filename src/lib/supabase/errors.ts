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

/**
 * Plain wording for the errors the Play saves and shares can raise
 * (migrations 46 and 47). The quota triggers open their message with a fixed
 * prefix (`playtest_sessions_quota_deck`, `..._user`, `playtest_shares_quota`)
 * precisely so this can match on it; the rest are matched by SQLSTATE.
 *
 * `undefined` for a table that does not exist yet means the migration has not
 * been applied to this database, which is worth saying out loud rather than
 * surfacing as "could not save": the code that reads these tables must never
 * ship ahead of the migration.
 */
export function playtestErrorMessage(error: { code?: string | null; message?: string | null }): string {
  const message = error.message ?? "";
  if (message.startsWith("playtest_sessions_quota_deck")) return "This deck already has 10 saved games. Delete one to save another.";
  if (message.startsWith("playtest_sessions_quota_user")) return "You have 30 saved games in total. Delete one to save another.";
  if (message.startsWith("playtest_shares_quota")) return "You have 10 active shared tables. Stop sharing one to share another.";
  switch (error.code) {
    case "42P01":
    case "PGRST205":
      return "Saving is not available yet: the database update for it has not been applied.";
    case "42501":
      return "You do not have permission to do that.";
    case "23503":
      return "That deck no longer exists.";
    case "23514":
      return "That could not be saved. The game may be too large, or its data is not valid.";
    default:
      return "That did not work. Try again in a moment.";
  }
}
