/**
 * Classifying "this column does not exist yet" errors.
 *
 * addWant's deck-tag branch and setWantDeck both hit this: whichever Postgres
 * or PostgREST code shows up for a not-yet-applied migration, it should
 * produce the friendly "apply this migration" message rather than a raw
 * database error leaking to the user.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isMissingColumnError } from "../src/lib/supabase/errors";

test("PGRST204 — PostgREST's insert/update schema-cache miss — is a missing column", () => {
  assert.equal(isMissingColumnError("PGRST204"), true);
});

test("42703 — Postgres's raw SELECT undefined column — is also a missing column", () => {
  assert.equal(isMissingColumnError("42703"), true);
});

test("an unrelated error code is not treated as a missing column", () => {
  assert.equal(isMissingColumnError("23505"), false);
  assert.equal(isMissingColumnError("PGRST205"), false);
});

test("no code at all is not a missing column", () => {
  assert.equal(isMissingColumnError(null), false);
  assert.equal(isMissingColumnError(undefined), false);
});
