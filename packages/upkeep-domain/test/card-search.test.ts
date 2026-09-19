/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_ADVANCED_FILTER,
  advancedFacetCount,
  isAdvancedFilterActive,
  looksLikeScryfallSyntax,
  matchesAdvancedCard,
  matchesColors,
  parseScryfallQuery,
  statToNumber,
} from "../src/card-search";

test("plain words are the name; nothing else is set", () => {
  const { filter, unsupported } = parseScryfallQuery("lightning bolt");
  assert.equal(filter.name, "lightning bolt");
  assert.equal(advancedFacetCount(filter), 0);
  assert.deepEqual(unsupported, []);
});

test("facets parse alongside name words", () => {
  const { filter } = parseScryfallQuery('goblin c:r cmc<=2 t:"legendary creature" s:dom r:rare');
  assert.equal(filter.name, "goblin");
  assert.deepEqual(filter.colors, ["R"]);
  assert.equal(filter.colorMode, "all");
  assert.deepEqual(filter.cmc, { op: "lte", value: 2 });
  assert.equal(filter.type, "legendary creature");
  assert.equal(filter.set, "dom");
  assert.equal(filter.rarity, "rare");
  assert.equal(advancedFacetCount(filter), 5);
});

test("colour operators map to modes; names and letters both work", () => {
  assert.equal(parseScryfallQuery("c=wu").filter.colorMode, "exactly");
  assert.equal(parseScryfallQuery("c<=wu").filter.colorMode, "atMost");
  assert.deepEqual(parseScryfallQuery("color:red,blue").filter.colors, ["R", "U"]);
});

test("unknown operators are reported, not read as name words", () => {
  const { filter, unsupported } = parseScryfallQuery("bolt is:foil pow>=3");
  assert.equal(filter.name, "bolt");
  assert.deepEqual(unsupported, ["is:foil", "pow>=3"]);
});

test("looksLikeScryfallSyntax tells a name from a query", () => {
  assert.equal(looksLikeScryfallSyntax("sol ring"), false);
  assert.equal(looksLikeScryfallSyntax("sol ring cmc:1"), true);
});

test("an empty filter is inactive", () => {
  assert.equal(isAdvancedFilterActive(EMPTY_ADVANCED_FILTER), false);
});

test("colour modes", () => {
  assert.equal(matchesColors(["W", "U"], ["W"], "all"), true);
  assert.equal(matchesColors(["W", "U"], ["W"], "exactly"), false);
  assert.equal(matchesColors(["W"], ["W", "U"], "atMost"), true);
  assert.equal(matchesColors(["G"], ["W", "U"], "any"), false);
});

test("loyalty text is not a number unless it is one", () => {
  assert.equal(statToNumber("X"), null);
  assert.equal(statToNumber("1+*"), null);
  assert.equal(statToNumber("4"), 4);
  const f = parseScryfallQuery("loy>=3").filter;
  assert.equal(matchesAdvancedCard({ colors: [], loyalty: "X" }, f), false);
  assert.equal(matchesAdvancedCard({ colors: [], loyalty: "5" }, f), true);
});

test("colourless cards match a colourless filter", () => {
  const f = parseScryfallQuery("c:c").filter;
  assert.equal(matchesAdvancedCard({ colors: null, loyalty: null }, f), true);
  assert.equal(matchesAdvancedCard({ colors: ["R"], loyalty: null }, f), false);
});
