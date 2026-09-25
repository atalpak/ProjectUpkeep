/**
 * Table preferences: defaults, and that stored junk cannot change their shape.
 *
 * Run with: npx tsx --test scripts/playtest-settings.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/lib/playtest/settings";

test("the card details column is on by default and survives a round trip", () => {
  assert.equal(DEFAULT_SETTINGS.cardDetails, true);
  assert.equal(sanitizeSettings({ cardDetails: false }).cardDetails, false);
  assert.equal(sanitizeSettings(JSON.parse(JSON.stringify(sanitizeSettings({ cardDetails: false })))).cardDetails, false);
});

test("junk in storage falls back to the defaults", () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings("nope"), DEFAULT_SETTINGS);
  assert.equal(sanitizeSettings({ cardDetails: "yes" }).cardDetails, true);
  assert.equal(sanitizeSettings({ keepSearchOpenWhileDragging: 1 }).keepSearchOpenWhileDragging, false);
});
