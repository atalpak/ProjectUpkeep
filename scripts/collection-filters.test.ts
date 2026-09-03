/**
 * Collection filter tests.
 *
 * The matching rules carry the edge cases that make a filter trustworthy or
 * not: colourless is a colour, printed power is not always a number, and a
 * quoted phrase means something different from two loose words.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EMPTY_FILTER,
  UNSORTED,
  activeFilterCount,
  applyFilter,
  filterFromParams,
  filterToParams,
  matchesFilter,
  statToNumber,
  type CollectionFilter,
} from "../src/lib/collection/filters";
import type { Card, CardInstanceWithCard } from "../src/lib/types";

function card(overrides: Partial<Card> = {}): Card {
  return {
    scryfall_id: "card-1",
    oracle_id: null,
    name: "Lightning Bolt",
    set_code: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: "161",
    rarity: "common",
    type_line: "Instant",
    released_at: "1993-08-05",
    image_uri: null,
    image_uri_small: null,
    scryfall_uri: null,
    available_finishes: ["nonfoil"],
    lang: "en",
    digital: false,
    last_synced_at: "2026-01-01T00:00:00Z",
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
    color_identity: ["R"],
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    flavor_text: null,
    keywords: [],
    power: null,
    toughness: null,
    loyalty: null,
    artist: "Christopher Rush",
    layout: "normal",
    card_faces: null,
    set_type: "core",
    price_usd: null,
    price_usd_foil: null,
    price_usd_etched: null,
    price_eur: null,
    price_eur_foil: null,
    tcgplayer_id: null,
    purchase_uri: null,
    prices_updated_at: null,
    ...overrides,
  };
}

function row(cardOverrides: Partial<Card> = {}, instance: Partial<CardInstanceWithCard> = {}) {
  return {
    id: "inst-1",
    owner_user_id: "user-1",
    card_id: "card-1",
    location_id: null,
    condition: "NM",
    finish: "nonfoil",
    language: "en",
    quantity: 1,
    notes: null,
    acquired_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    cards: card(cardOverrides),
    locations: null,
    ...instance,
  } as CardInstanceWithCard;
}

const f = (overrides: Partial<CollectionFilter>): CollectionFilter => ({
  ...EMPTY_FILTER,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Nothing selected
// ---------------------------------------------------------------------------

test("an empty filter matches everything", () => {
  assert.equal(matchesFilter(row(), EMPTY_FILTER), true);
  assert.equal(activeFilterCount(EMPTY_FILTER), 0);
});

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

test("name matching is case-insensitive and partial", () => {
  assert.equal(matchesFilter(row(), f({ name: "light" })), true);
  assert.equal(matchesFilter(row(), f({ name: "LIGHTNING" })), true);
  assert.equal(matchesFilter(row(), f({ name: "counterspell" })), false);
});

test("loose words must all appear, in any order", () => {
  assert.equal(matchesFilter(row(), f({ oracle: "damage target" })), true);
  assert.equal(matchesFilter(row(), f({ oracle: "damage unicorn" })), false);
});

test("a quoted phrase must appear exactly", () => {
  assert.equal(matchesFilter(row(), f({ oracle: '"3 damage to any target"' })), true);
  assert.equal(matchesFilter(row(), f({ oracle: '"damage to any unicorn"' })), false);
});

test("oracle search reaches the back face of a transform card", () => {
  const fable = row({
    name: "Fable of the Mirror-Breaker",
    oracle_text: "Create a 2/2 red Goblin Shaman creature token.",
    card_faces: [
      { name: "Fable of the Mirror-Breaker", oracle_text: "Create a 2/2 red Goblin Shaman." },
      { name: "Reflection of Kiki-Jiki", oracle_text: "Create a token that's a copy." },
    ],
  });
  assert.equal(matchesFilter(fable, f({ oracle: "copy" })), true, "back face counts");
});

test("type line matching", () => {
  assert.equal(matchesFilter(row(), f({ type: "instant" })), true);
  assert.equal(matchesFilter(row({ type_line: "Creature — Goblin" }), f({ type: "goblin" })), true);
  assert.equal(matchesFilter(row(), f({ type: "creature" })), false);
});

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const azorius = { colors: ["W", "U"] as string[] };

test("'all' requires every selected colour", () => {
  assert.equal(matchesFilter(row(azorius), f({ colors: ["W"], colorMode: "all" })), true);
  assert.equal(matchesFilter(row(azorius), f({ colors: ["W", "U"], colorMode: "all" })), true);
  assert.equal(matchesFilter(row(azorius), f({ colors: ["W", "B"], colorMode: "all" })), false);
});

test("'any' requires at least one", () => {
  assert.equal(matchesFilter(row(azorius), f({ colors: ["W", "B"], colorMode: "any" })), true);
  assert.equal(matchesFilter(row(azorius), f({ colors: ["B", "G"], colorMode: "any" })), false);
});

test("'exactly' requires the same set", () => {
  assert.equal(matchesFilter(row(azorius), f({ colors: ["W", "U"], colorMode: "exactly" })), true);
  assert.equal(matchesFilter(row(azorius), f({ colors: ["W"], colorMode: "exactly" })), false);
});

test("'at most' allows a subset", () => {
  assert.equal(
    matchesFilter(row({ colors: ["W"] }), f({ colors: ["W", "U"], colorMode: "atMost" })),
    true,
  );
  assert.equal(
    matchesFilter(row({ colors: ["W", "B"] }), f({ colors: ["W", "U"], colorMode: "atMost" })),
    false,
  );
});

test("a colourless card is matched as C, not as 'no colours'", () => {
  const signet = row({ name: "Arcane Signet", colors: [], color_identity: [] });
  assert.equal(matchesFilter(signet, f({ colors: ["C"], colorMode: "all" })), true);
  assert.equal(matchesFilter(signet, f({ colors: ["R"], colorMode: "all" })), false);
});

test("colour identity is a containment test", () => {
  const golgari = row({ colors: ["B"], color_identity: ["B", "G"] });
  assert.equal(matchesFilter(golgari, f({ colorIdentity: ["B"] })), true);
  assert.equal(matchesFilter(golgari, f({ colorIdentity: ["B", "G"] })), true);
  assert.equal(matchesFilter(golgari, f({ colorIdentity: ["B", "U"] })), false);
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

test("mana value comparisons", () => {
  assert.equal(matchesFilter(row(), f({ manaValue: { op: "eq", value: 1 } })), true);
  assert.equal(matchesFilter(row(), f({ manaValue: { op: "gte", value: 1 } })), true);
  assert.equal(matchesFilter(row(), f({ manaValue: { op: "gt", value: 1 } })), false);
  assert.equal(matchesFilter(row(), f({ manaValue: { op: "lt", value: 3 } })), true);
  assert.equal(matchesFilter(row(), f({ manaValue: { op: "ne", value: 4 } })), true);
});

test("a zero mana value is a real value, not a missing one", () => {
  const ornithopter = row({ name: "Ornithopter", cmc: 0, mana_cost: "{0}" });
  assert.equal(matchesFilter(ornithopter, f({ manaValue: { op: "eq", value: 0 } })), true);
  assert.equal(matchesFilter(ornithopter, f({ manaValue: { op: "lt", value: 1 } })), true);
});

test("power and toughness comparisons", () => {
  const bear = row({ power: "2", toughness: "2", type_line: "Creature — Bear" });
  assert.equal(matchesFilter(bear, f({ power: { op: "gte", value: 2 } })), true);
  assert.equal(matchesFilter(bear, f({ toughness: { op: "lt", value: 2 } })), false);
});

test("a card with no power cannot satisfy a power filter", () => {
  assert.equal(matchesFilter(row(), f({ power: { op: "gte", value: 0 } })), false);
});

test("star power is excluded rather than counted as zero", () => {
  const tarmogoyf = row({ power: "*", toughness: "1+*" });
  assert.equal(statToNumber("*"), null);
  assert.equal(statToNumber("1+*"), null);
  assert.equal(matchesFilter(tarmogoyf, f({ power: { op: "gte", value: 0 } })), false);
});

test("loyalty comparisons", () => {
  const jace = row({ loyalty: "3", type_line: "Legendary Planeswalker — Jace" });
  assert.equal(matchesFilter(jace, f({ loyalty: { op: "eq", value: 3 } })), true);
  assert.equal(matchesFilter(jace, f({ loyalty: { op: "gt", value: 3 } })), false);
});

// ---------------------------------------------------------------------------
// Mana cost
// ---------------------------------------------------------------------------

test("mana cost matches the symbols asked for", () => {
  assert.equal(matchesFilter(row(), f({ manaCost: "{R}" })), true);
  assert.equal(matchesFilter(row(), f({ manaCost: "{U}" })), false);
});

test("mana cost is count-aware", () => {
  const twoGreen = row({ mana_cost: "{2}{G}{G}" });
  assert.equal(matchesFilter(twoGreen, f({ manaCost: "{G}{G}" })), true);
  assert.equal(matchesFilter(twoGreen, f({ manaCost: "{G}{G}{G}" })), false);
});

test("mana cost accepts unbraced input", () => {
  assert.equal(matchesFilter(row({ mana_cost: "{2}{G}" }), f({ manaCost: "2G" })), true);
});

// ---------------------------------------------------------------------------
// Instance-level criteria
// ---------------------------------------------------------------------------

test("condition, finish and language filter the copy, not the printing", () => {
  const foil = row({}, { finish: "foil", condition: "LP", language: "ja" });
  assert.equal(matchesFilter(foil, f({ finish: "foil" })), true);
  assert.equal(matchesFilter(foil, f({ finish: "nonfoil" })), false);
  assert.equal(matchesFilter(foil, f({ condition: "LP" })), true);
  assert.equal(matchesFilter(foil, f({ language: "ja" })), true);
  assert.equal(matchesFilter(foil, f({ language: "en" })), false);
});

test("unsorted is a real location, distinct from any location", () => {
  const unsorted = row({}, { location_id: null });
  const filed = row({}, { location_id: "binder-1" });

  assert.equal(matchesFilter(unsorted, f({ location: UNSORTED })), true);
  assert.equal(matchesFilter(filed, f({ location: UNSORTED })), false);
  assert.equal(matchesFilter(filed, f({ location: "binder-1" })), true);
  assert.equal(matchesFilter(unsorted, f({ location: "binder-1" })), false);
});

test("criteria combine as AND", () => {
  const rows = [
    row({ name: "Lightning Bolt", colors: ["R"], cmc: 1 }),
    row({ name: "Counterspell", colors: ["U"], cmc: 2 }, { id: "inst-2" }),
    row({ name: "Lightning Helix", colors: ["R", "W"], cmc: 2 }, { id: "inst-3" }),
  ];
  const result = applyFilter(rows, f({ colors: ["R"], manaValue: { op: "eq", value: 2 } }));
  assert.equal(result.length, 1);
  assert.equal(result[0].cards?.name, "Lightning Helix");
});

// ---------------------------------------------------------------------------
// URL round trip
// ---------------------------------------------------------------------------

test("a filter survives a round trip through the URL", () => {
  const original = f({
    name: "bolt",
    oracle: '"any target"',
    colors: ["R", "G"],
    colorMode: "any",
    colorIdentity: ["R"],
    manaValue: { op: "lte", value: 3 },
    manaCost: "{R}",
    power: { op: "gt", value: 2 },
    rarity: "rare",
    condition: "LP",
    finish: "foil",
    language: "ja",
    location: UNSORTED,
  });

  const restored = filterFromParams(Object.fromEntries(filterToParams(original)));
  assert.deepEqual(restored, original);
});

test("defaults are left out of the URL", () => {
  assert.equal(filterToParams(EMPTY_FILTER).toString(), "");
});

test("colour mode is only carried when colours are selected", () => {
  const params = filterToParams(f({ colorMode: "any" }));
  assert.equal(params.get("colorMode"), null);
});

test("junk in the URL is ignored rather than trusted", () => {
  const restored = filterFromParams({
    colors: "R,ZZ,G",
    mv: "notanop:3",
    pow: "gte:notanumber",
    rarity: "legendary",
    condition: "PERFECT",
  });
  assert.deepEqual(restored.colors, ["R", "G"]);
  assert.equal(restored.manaValue, null);
  assert.equal(restored.power, null);
  assert.equal(restored.rarity, "");
  assert.equal(restored.condition, "");
});

test("the active count drives the badge", () => {
  assert.equal(activeFilterCount(f({ name: "bolt" })), 1);
  assert.equal(activeFilterCount(f({ name: "bolt", rarity: "rare" })), 2);
  assert.equal(
    activeFilterCount(f({ colors: ["R"], colorMode: "any" })),
    1,
    "the mode qualifies the colours rather than counting as its own criterion",
  );
});
