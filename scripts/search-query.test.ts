/**
 * Advanced card search — structured filter round trip and the literal
 * Scryfall syntax reader.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EMPTY_ADVANCED_FILTER,
  advancedFilterFromParams,
  advancedFilterToParams,
  isAdvancedFilterActive,
  parseScryfallQuery,
} from "../src/lib/cards/search-query";
import type { Color } from "../src/lib/collection/filters";

test("isAdvancedFilterActive is false for the empty filter", () => {
  assert.equal(isAdvancedFilterActive(EMPTY_ADVANCED_FILTER), false);
});

test("isAdvancedFilterActive is true once any facet is set", () => {
  assert.equal(isAdvancedFilterActive({ ...EMPTY_ADVANCED_FILTER, type: "creature" }), true);
  assert.equal(
    isAdvancedFilterActive({ ...EMPTY_ADVANCED_FILTER, colors: ["R"] }),
    true,
  );
});

test("filter round-trips through URL params", () => {
  const filter = {
    ...EMPTY_ADVANCED_FILTER,
    name: "bolt",
    colors: ["R"] as Color[],
    colorMode: "exactly" as const,
    cmc: { op: "lte" as const, value: 2 },
    type: "instant",
    oracle: "damage",
    set: "lea",
    rarity: "common",
  };
  const params = advancedFilterToParams(filter);
  assert.deepEqual(advancedFilterFromParams(params), filter);
});

test("advancedFilterFromParams defaults to the empty filter", () => {
  assert.deepEqual(advancedFilterFromParams(new URLSearchParams()), EMPTY_ADVANCED_FILTER);
});

test("advancedFilterFromParams drops a garbage colorMode", () => {
  const params = new URLSearchParams({ colors: "R", colorMode: "nonsense" });
  assert.equal(advancedFilterFromParams(params).colorMode, "all");
});

test("parseScryfallQuery reads color, cmc, type, oracle, set and rarity", () => {
  const { filter, unsupported } = parseScryfallQuery('c:r cmc<=2 t:creature o:"first strike" s:lea r:common');
  assert.deepEqual(filter.colors, ["R"]);
  assert.equal(filter.colorMode, "all");
  assert.deepEqual(filter.cmc, { op: "lte", value: 2 });
  assert.equal(filter.type, "creature");
  assert.equal(filter.oracle, "first strike");
  assert.equal(filter.set, "lea");
  assert.equal(filter.rarity, "common");
  assert.equal(unsupported.length, 0);
});

test("parseScryfallQuery reads exact and at-most colour identity", () => {
  assert.deepEqual(parseScryfallQuery("c=wu").filter, {
    ...EMPTY_ADVANCED_FILTER,
    colors: ["W", "U"],
    colorMode: "exactly",
  });
  assert.deepEqual(parseScryfallQuery("c<=rg").filter, {
    ...EMPTY_ADVANCED_FILTER,
    colors: ["R", "G"],
    colorMode: "atMost",
  });
});

test("parseScryfallQuery accepts colour names, not just letters", () => {
  assert.deepEqual(parseScryfallQuery("color:red,blue").filter.colors.sort(), ["R", "U"]);
});

test("parseScryfallQuery keeps every numeric comparator", () => {
  assert.deepEqual(parseScryfallQuery("cmc>=3").filter.cmc, { op: "gte", value: 3 });
  assert.deepEqual(parseScryfallQuery("mv!=1").filter.cmc, { op: "ne", value: 1 });
  assert.deepEqual(parseScryfallQuery("cmc:0").filter.cmc, { op: "eq", value: 0 });
});

test("parseScryfallQuery folds bare words into the name, quotes and all", () => {
  const { filter } = parseScryfallQuery('lightning "bolt of doom"');
  assert.equal(filter.name, "lightning bolt of doom");
});

test("parseScryfallQuery flags recognisable syntax it does not implement", () => {
  const { unsupported } = parseScryfallQuery("is:foil bolt");
  assert.deepEqual(unsupported, ["is:foil"]);
});

test("parseScryfallQuery mixes name words with structured facets", () => {
  const { filter, unsupported } = parseScryfallQuery("sol ring cmc:1");
  assert.equal(filter.name, "sol ring");
  assert.deepEqual(filter.cmc, { op: "eq", value: 1 });
  assert.equal(unsupported.length, 0);
});
