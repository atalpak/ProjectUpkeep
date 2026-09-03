/**
 * Trading-terms acceptance checks.
 *
 * Three states matter: accepted the current version, accepted an old version,
 * and "cannot tell" (the columns do not exist yet). The last one must not block
 * trading, or deploying the feature ahead of its migration locks everyone out.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CURRENT_TOS_VERSION,
  hasAcceptedTos,
  shouldGateTrading,
  tradingAllowed,
} from "../src/lib/social/tos";

test("current-version acceptance passes every check", () => {
  const status = { accepted_at: "2026-09-01T00:00:00Z", version: CURRENT_TOS_VERSION };
  assert.equal(hasAcceptedTos(status), true);
  assert.equal(shouldGateTrading(status), false);
  assert.equal(tradingAllowed(status), true);
});

test("a stale accepted version is treated as not accepted", () => {
  const status = { accepted_at: "2025-01-01T00:00:00Z", version: "2025-01-01" };
  assert.equal(hasAcceptedTos(status), false);
  assert.equal(shouldGateTrading(status), true, "a real un-accepted row is gated");
  assert.equal(tradingAllowed(status), false);
});

test("a real row that was never accepted is gated", () => {
  const status = { accepted_at: null, version: null };
  assert.equal(hasAcceptedTos(status), false);
  assert.equal(shouldGateTrading(status), true);
  assert.equal(tradingAllowed(status), false);
});

test("null status — columns missing — never blocks and never gates", () => {
  assert.equal(hasAcceptedTos(null), false);
  assert.equal(shouldGateTrading(null), false, "no dead-end gate before the migration");
  assert.equal(tradingAllowed(null), true, "trading works as before until the migration lands");
});

test("a timestamp without a matching version does not count", () => {
  const status = { accepted_at: "2026-09-01T00:00:00Z", version: null };
  assert.equal(hasAcceptedTos(status), false);
});
