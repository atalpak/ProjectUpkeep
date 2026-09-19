/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CURRENT_TOS_VERSION, acceptedCurrentTos } from "../src/tos";

test("accepting the version in force counts", () => {
  assert.equal(acceptedCurrentTos("2026-09-01T00:00:00Z", CURRENT_TOS_VERSION), true);
});

test("an older version, or no acceptance at all, does not", () => {
  assert.equal(acceptedCurrentTos("2025-01-01T00:00:00Z", "2025-01-01"), false);
  assert.equal(acceptedCurrentTos(null, CURRENT_TOS_VERSION), false);
  assert.equal(acceptedCurrentTos("2026-09-01T00:00:00Z", null), false);
});
