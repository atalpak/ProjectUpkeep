/**
 * The recovery-marker cookie: its attributes, and how the PKCE branch of
 * /auth/confirm infers "this is a recovery" from the redirect target.
 *
 * Run with: npx tsx --test scripts/recovery.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECOVERY_COOKIE,
  RECOVERY_COOKIE_MAX_AGE,
  RECOVERY_NEXT,
  isRecoveryNext,
  recoveryCookieOptions,
} from "../src/lib/auth/recovery";

test("the marker's identity is a fixed, non-secret name", () => {
  // Presence is the whole signal, so the name must not drift between the writer
  // (/auth/confirm) and the two readers (/auth/reset/new, setNewPassword).
  assert.equal(RECOVERY_COOKIE, "pw_recovery");
});

test("cookie is locked down: httpOnly, lax, path-scoped, short-lived", () => {
  const opts = recoveryCookieOptions(true);
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "lax");
  assert.equal(opts.path, "/auth");
  assert.equal(opts.maxAge, RECOVERY_COOKIE_MAX_AGE);
  assert.equal(RECOVERY_COOKIE_MAX_AGE, 60 * 15);
});

test("secure follows the environment", () => {
  assert.equal(recoveryCookieOptions(true).secure, true);
  assert.equal(recoveryCookieOptions(false).secure, false, "plain-HTTP localhost");
});

test("recovery is inferred only from the exact reset target", () => {
  assert.equal(isRecoveryNext(RECOVERY_NEXT), true);
  assert.equal(isRecoveryNext("/collection"), false);
  assert.equal(isRecoveryNext("/auth/reset"), false);
  assert.equal(isRecoveryNext(null), false);
  assert.equal(isRecoveryNext(undefined), false);
});
