/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MIN_PASSWORD_LENGTH, validateNewPassword, validateUsername } from "../src/password";

test("the floor is eight, matching what signup and recovery promise", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
});

test("rejects a short password, naming the floor", () => {
  const r = validateNewPassword("short");
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /at least 8 characters/);
});

test("accepts exactly the floor, and a single field needs no confirmation", () => {
  assert.deepEqual(validateNewPassword("12345678"), { ok: true });
});

test("length is checked before the confirmation", () => {
  const r = validateNewPassword("abc", "xyz");
  assert.match(r.ok ? "" : r.error, /characters/);
});

test("a mismatched confirmation fails; a matching one passes", () => {
  const bad = validateNewPassword("battery staple", "battery stapte");
  assert.match(bad.ok ? "" : bad.error, /do not match/);
  assert.deepEqual(validateNewPassword("battery staple", "battery staple"), { ok: true });
  assert.equal(validateNewPassword("battery staple", "").ok, false, "an empty confirmation is still a confirmation");
});

test("usernames: 3-32 of letters, digits, underscore, hyphen", () => {
  for (const ok of ["abc", "Mox_Pearl-7", "a".repeat(32)]) assert.equal(validateUsername(ok).ok, true, ok);
  for (const bad of ["ab", "a".repeat(33), "has space", "emoji\u{1F600}", "dot.name", ""]) assert.equal(validateUsername(bad).ok, false, bad);
});
