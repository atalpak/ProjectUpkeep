/**
 * Trade-offer expiry.
 *
 * The timestamp is the source of truth; these helpers turn it into a yes/no and
 * a phrase. The clock is injectable so the tests are not time-of-day flaky.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXPIRY_DAYS,
  expiringSoon,
  expiryFromNow,
  expiryLabel,
  isExpired,
} from "../src/lib/social/trade-status";

const NOW = Date.parse("2026-09-01T12:00:00Z");
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

test("a proposal past its expiry is expired", () => {
  assert.equal(isExpired({ expires_at: inDays(-1), status: "proposed" }, NOW), true);
  assert.equal(isExpired({ expires_at: inDays(3), status: "proposed" }, NOW), false);
});

test("a null expiry never expires", () => {
  assert.equal(isExpired({ expires_at: null, status: "proposed" }, NOW), false);
});

test("only open proposals can be 'expired' — a settled trade never is", () => {
  assert.equal(isExpired({ expires_at: inDays(-30), status: "completed" }, NOW), false);
  assert.equal(isExpired({ expires_at: inDays(-30), status: "declined" }, NOW), false);
  // status omitted → treat as still open
  assert.equal(isExpired({ expires_at: inDays(-1) }, NOW), true);
});

test("expiryLabel phrases the time remaining", () => {
  assert.equal(expiryLabel(inDays(5), NOW), "Expires in 5 days");
  assert.equal(expiryLabel(inDays(2), NOW), "Expires tomorrow");
  assert.equal(expiryLabel(inDays(0.5), NOW), "Expires today");
  assert.equal(expiryLabel(null, NOW), null);
});

test("expiryLabel phrases time already past", () => {
  assert.equal(expiryLabel(inDays(-0.2), NOW), "Expired");
  assert.equal(expiryLabel(inDays(-3), NOW), "Expired 3 days ago");
});

test("expiringSoon is true only within two days and not yet past", () => {
  assert.equal(expiringSoon(inDays(1), NOW), true);
  assert.equal(expiringSoon(inDays(3), NOW), false);
  assert.equal(expiringSoon(inDays(-1), NOW), false);
  assert.equal(expiringSoon(null, NOW), false);
});

test("expiryFromNow is EXPIRY_DAYS out", () => {
  const iso = expiryFromNow(NOW);
  assert.equal(Date.parse(iso) - NOW, EXPIRY_DAYS * 86_400_000);
});
