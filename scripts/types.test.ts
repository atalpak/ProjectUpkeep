/**
 * Small pure helpers in src/lib/types.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cardDisplayName } from "../src/lib/types";

test("cardDisplayName leads with the real name, printed alternate in parens", () => {
  assert.equal(
    cardDisplayName({ name: "Spark Double", flavor_name: "Loki's Double" }),
    "Spark Double (Loki's Double)",
  );
});

test("cardDisplayName falls back to the real name with no flavor name", () => {
  assert.equal(cardDisplayName({ name: "Lightning Bolt", flavor_name: null }), "Lightning Bolt");
  assert.equal(cardDisplayName({ name: "Lightning Bolt" }), "Lightning Bolt");
});

test("cardDisplayName treats an empty-string flavor name as absent", () => {
  assert.equal(cardDisplayName({ name: "Lightning Bolt", flavor_name: "" }), "Lightning Bolt");
});
