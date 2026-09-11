/**
 * The re-auth failure classification shared by password change and account
 * deletion — see src/lib/auth/reauth.ts for why one function backs both.
 *
 * Run with: npx tsx --test scripts/reauth.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { reauthErrorMessage } from "../src/lib/auth/reauth";

test("names rate limiting by status code", () => {
  assert.match(reauthErrorMessage({ status: 429 }), /too many attempts/i);
});

test("names rate limiting by Supabase's error code, even without the status", () => {
  assert.match(
    reauthErrorMessage({ code: "over_request_rate_limit" }),
    /too many attempts/i,
  );
});

test("treats anything else as a wrong password", () => {
  assert.match(reauthErrorMessage({ status: 400, code: "invalid_credentials" }), /isn't right/);
  assert.match(reauthErrorMessage({}), /isn't right/);
});
