/**
 * The shared new-password rules — length floor and confirmation match — used by
 * signup, the recovery flow and the settings change-password form.
 *
 * Run with: npx tsx --test scripts/password.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_PASSWORD_LENGTH, validateNewPassword } from "../src/lib/auth/password";

test("rejects a password shorter than the floor", () => {
  const result = validateNewPassword("short", "short");
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /8 characters/);
});

test("rejects when the confirmation does not match", () => {
  const result = validateNewPassword("battery staple", "battery stapte");
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /do not match/);
});

test("accepts a long-enough matching pair", () => {
  assert.deepEqual(validateNewPassword("battery staple", "battery staple"), { ok: true });
});

test("accepts exactly the minimum length", () => {
  const exact = "x".repeat(MIN_PASSWORD_LENGTH);
  assert.deepEqual(validateNewPassword(exact, exact), { ok: true });
});

test("rejects one character below the minimum", () => {
  const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
  assert.equal(validateNewPassword(short, short).ok, false);
});

test("skips the match check when no confirmation is supplied", () => {
  // Signup has a single password field; length is still enforced.
  assert.deepEqual(validateNewPassword("long enough"), { ok: true });
  assert.equal(validateNewPassword("short").ok, false);
});
