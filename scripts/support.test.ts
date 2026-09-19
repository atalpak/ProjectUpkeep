/**
 * The support address constant.
 *
 * This guards any future change of inbox (see src/lib/support.ts): a value
 * that is not a plausible single email address — whitespace, a missing `@`, a
 * comment left in — fails here rather than shipping as a dead `mailto:` link
 * on the privacy page.
 *
 * Run with: npx tsx --test scripts/support.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { SUPPORT_EMAIL } from "../src/lib/support";

test("SUPPORT_EMAIL is a single, well-formed email address", () => {
  assert.match(SUPPORT_EMAIL, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
});
