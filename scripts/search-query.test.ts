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
  matchesAdvancedCard,
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
    loyalty: { op: "eq" as const, value: 7 },
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

test("parseScryfallQuery reads loyalty, both spellings and every comparator", () => {
  assert.deepEqual(parseScryfallQuery("loy=7").filter.loyalty, { op: "eq", value: 7 });
  assert.deepEqual(parseScryfallQuery("loyalty>=5").filter.loyalty, { op: "gte", value: 5 });
  assert.deepEqual(parseScryfallQuery("loy:3").filter.loyalty, { op: "eq", value: 3 });
});

test("parseScryfallQuery reads type and loyalty together, the reported bug", () => {
  const { filter, unsupported } = parseScryfallQuery("t:planeswalker loy=7");
  assert.equal(filter.type, "planeswalker");
  assert.deepEqual(filter.loyalty, { op: "eq", value: 7 });
  assert.equal(unsupported.length, 0);
});

test("matchesAdvancedCard checks loyalty against the filter", () => {
  const filter = { ...EMPTY_ADVANCED_FILTER, loyalty: { op: "eq" as const, value: 7 } };
  assert.equal(matchesAdvancedCard({ colors: null, loyalty: "7" }, filter), true);
  assert.equal(matchesAdvancedCard({ colors: null, loyalty: "6" }, filter), false);
  // "X" loyalty (Gideon, Blaze of Glory and the like) is not a number, so it
  // never matches a numeric loyalty filter rather than being coerced to 0.
  assert.equal(matchesAdvancedCard({ colors: null, loyalty: "X" }, filter), false);
});

test("matchesAdvancedCard with no loyalty filter accepts any loyalty", () => {
  assert.equal(
    matchesAdvancedCard({ colors: null, loyalty: "X" }, EMPTY_ADVANCED_FILTER),
    true,
  );
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
