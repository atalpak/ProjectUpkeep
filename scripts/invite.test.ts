/**
 * The signup invite gate — two states, not fail-closed. Unset (or
 * whitespace-only) `SIGNUP_INVITE_CODE` means signup is open; a configured
 * code makes it required.
 *
 * Run with: npx tsx --test scripts/invite.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { inviteCodeAccepted, signupInviteDecision } from "../src/lib/auth/invite";

test("inviteCodeAccepted: no expected code, empty input", () => {
  assert.equal(inviteCodeAccepted("", undefined), false);
});

test("inviteCodeAccepted: no expected code, any input", () => {
  assert.equal(inviteCodeAccepted("hunter2", undefined), false);
  assert.equal(inviteCodeAccepted("", ""), false);
  assert.equal(inviteCodeAccepted("guess", ""), false);
});

test("inviteCodeAccepted: whitespace-only expected code is treated as unset", () => {
  assert.equal(inviteCodeAccepted("guess", "   "), false);
});

test("inviteCodeAccepted: accepts an exact match", () => {
  assert.equal(inviteCodeAccepted("playgroup-2026", "playgroup-2026"), true);
});

test("inviteCodeAccepted: accepts a match once surrounding whitespace is trimmed", () => {
  assert.equal(inviteCodeAccepted("  playgroup-2026 \n", "playgroup-2026"), true);
});

test("inviteCodeAccepted: rejects a mismatch", () => {
  assert.equal(inviteCodeAccepted("playgroup-2025", "playgroup-2026"), false);
  assert.equal(inviteCodeAccepted("", "playgroup-2026"), false);
});

test("signupInviteDecision: open when the code is unset, no input typed", () => {
  assert.equal(signupInviteDecision("", undefined), "open");
});

test("signupInviteDecision: open when the code is unset, something typed anyway", () => {
  assert.equal(signupInviteDecision("hunter2", undefined), "open");
});

test("signupInviteDecision: open when the code is empty", () => {
  assert.equal(signupInviteDecision("", ""), "open");
  assert.equal(signupInviteDecision("guess", ""), "open");
});

test("signupInviteDecision: open when the code is whitespace-only", () => {
  assert.equal(signupInviteDecision("", "   "), "open");
  assert.equal(signupInviteDecision("guess", "   "), "open");
});

test("signupInviteDecision: accepts an exact match once required", () => {
  assert.equal(signupInviteDecision("playgroup-2026", "playgroup-2026"), "accept");
});

test("signupInviteDecision: accepts a match once surrounding whitespace is trimmed", () => {
  assert.equal(
    signupInviteDecision("  playgroup-2026 \n", "playgroup-2026"),
    "accept",
  );
});

test("signupInviteDecision: rejects a mismatch once required", () => {
  assert.equal(signupInviteDecision("playgroup-2025", "playgroup-2026"), "reject");
});

test("signupInviteDecision: rejects a blank input once required", () => {
  assert.equal(signupInviteDecision("", "playgroup-2026"), "reject");
});
