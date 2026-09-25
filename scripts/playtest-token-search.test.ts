/**
 * The token panel asks `/api/cards/search?type=Token&q=...`. This checks the
 * half that can be checked without a database: that the request takes the
 * advanced (direct `cards` query) branch of the route, with the type and the
 * name carried through. What it does NOT prove is that the live `cards` table
 * returns token rows for it: that needs a catalogue, and is recorded as
 * unverified in PLAYTESTER_BUILD_HANDOFF.md.
 *
 * Run with: npx tsx --test scripts/playtest-token-search.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { advancedFilterFromParams, isAdvancedFilterActive } from "../src/lib/cards/search-query";

test("a token request takes the advanced branch with the type and name intact", () => {
  const params = new URLSearchParams("type=Token&q=soldier");
  const filter = advancedFilterFromParams(params);
  assert.equal(filter.type, "Token");
  assert.equal(filter.name, "soldier");
  // The route's own test for the advanced branch: the type alone is enough.
  assert.equal(isAdvancedFilterActive({ ...filter, name: "" }), true);
});

test("a plain name with no type stays on the basic path", () => {
  const filter = advancedFilterFromParams(new URLSearchParams("q=soldier"));
  assert.equal(filter.type, "");
  assert.equal(isAdvancedFilterActive({ ...filter, name: "" }), false);
});

test("hostile input in the token query is carried as data, not parsed", () => {
  const filter = advancedFilterFromParams(new URLSearchParams({ type: "Token", q: "%'; drop table cards;--" }));
  assert.equal(filter.name, "%'; drop table cards;--");
  assert.equal(filter.type, "Token");
});
