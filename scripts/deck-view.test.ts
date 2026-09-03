/**
 * Deck grouping and ordering.
 *
 * The categorisation rules are the ones a decklist gets judged on: a card must
 * appear exactly once, under the heading a player would look for it under.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  colorRank,
  compareBy,
  groupDeck,
  manaSymbols,
  sectionFor,
} from "../src/lib/collection/deck-view";
import type { Card, CardInstanceWithCard } from "../src/lib/types";

let counter = 0;
function row(card: Partial<Card>, quantity = 1): CardInstanceWithCard {
  counter += 1;
  return {
    id: `inst-${counter}`,
    owner_user_id: "user-1",
    card_id: `card-${counter}`,
    location_id: "deck-1",
    condition: "NM",
    finish: "nonfoil",
    language: "en",
    quantity,
    notes: null,
    acquired_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    locations: { id: "deck-1", name: "Deck", type: "deck" },
    cards: {
      scryfall_id: `card-${counter}`,
      oracle_id: null,
      name: "Card",
      set_code: "tst",
      set_name: "Test",
      collector_number: "1",
      rarity: "common",
      type_line: "Instant",
      released_at: "2020-01-01",
      image_uri: null,
      image_uri_small: null,
      scryfall_uri: null,
      available_finishes: ["nonfoil"],
      lang: "en",
      digital: false,
      last_synced_at: "2026-01-01T00:00:00Z",
      mana_cost: null,
      cmc: null,
      colors: null,
      color_identity: null,
      oracle_text: null,
      flavor_text: null,
      keywords: null,
      power: null,
      toughness: null,
      loyalty: null,
      artist: null,
      layout: "normal",
      card_faces: null,
      set_type: "expansion",
      price_usd: null,
      price_usd_foil: null,
      price_usd_etched: null,
      price_eur: null,
      price_eur_foil: null,
      tcgplayer_id: null,
      purchase_uri: null,
      prices_updated_at: null,
      ...card,
    },
  } as CardInstanceWithCard;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

test("the plain types land where you expect", () => {
  assert.equal(sectionFor("Instant"), "instants");
  assert.equal(sectionFor("Sorcery"), "sorceries");
  assert.equal(sectionFor("Artifact"), "artifacts");
  assert.equal(sectionFor("Enchantment"), "enchantments");
  assert.equal(sectionFor("Creature — Goblin"), "creatures");
  assert.equal(sectionFor("Legendary Planeswalker — Jace"), "planeswalkers");
  assert.equal(sectionFor("Basic Land — Mountain"), "lands");
});

test("a creature that is also an artifact is a creature", () => {
  assert.equal(sectionFor("Artifact Creature — Golem"), "creatures");
  assert.equal(sectionFor("Enchantment Creature — Nymph"), "creatures");
  assert.equal(sectionFor("Legendary Artifact Creature — Golem"), "creatures");
});

test("a land that is also an artifact is still a land", () => {
  assert.equal(sectionFor("Artifact Land"), "lands");
  assert.equal(
    sectionFor("Land Creature — Forest Dryad"),
    "lands",
    "Dryad Arbor is looked for under lands",
  );
});

test("a double-faced card is filed by its front face", () => {
  assert.equal(sectionFor("Enchantment — Saga // Enchantment Creature — Goblin"), "enchantments");
  assert.equal(sectionFor("Creature — Human // Land"), "creatures");
});

test("anything unrecognised has a home rather than vanishing", () => {
  assert.equal(sectionFor(null), "other");
  assert.equal(sectionFor(""), "other");
  assert.equal(sectionFor("Dungeon"), "other");
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

test("sections keep their canonical order and empty ones are dropped", () => {
  const groups = groupDeck(
    [
      row({ name: "Mountain", type_line: "Basic Land — Mountain" }),
      row({ name: "Bolt", type_line: "Instant" }),
      row({ name: "Bear", type_line: "Creature — Bear" }),
    ],
    "name",
  );

  assert.deepEqual(
    groups.map((g) => g.section),
    ["creatures", "instants", "lands"],
    "no sorceries heading for a deck with no sorceries",
  );
});

test("section counts are physical cards, not rows", () => {
  const groups = groupDeck(
    [
      row({ name: "Mountain", type_line: "Basic Land — Mountain" }, 9),
      row({ name: "Forest", type_line: "Basic Land — Forest" }, 6),
    ],
    "name",
  );
  assert.equal(groups[0].cardCount, 15);
  assert.equal(groups[0].rows.length, 2);
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const sortedNames = (rows: CardInstanceWithCard[], sort: Parameters<typeof compareBy>[0]) =>
  [...rows].sort(compareBy(sort)).map((r) => r.cards?.name);

test("name sorts alphabetically", () => {
  const rows = [row({ name: "Zebra" }), row({ name: "Aardvark" })];
  assert.deepEqual(sortedNames(rows, "name"), ["Aardvark", "Zebra"]);
});

test("mana value sorts cheapest first, ties broken by name", () => {
  const rows = [
    row({ name: "Big", cmc: 7 }),
    row({ name: "Zed", cmc: 1 }),
    row({ name: "Abe", cmc: 1 }),
  ];
  assert.deepEqual(sortedNames(rows, "manaValue"), ["Abe", "Zed", "Big"]);
});

test("a land with no mana value is not shoved to the end", () => {
  const rows = [row({ name: "Bolt", cmc: 1 }), row({ name: "Mountain", cmc: null })];
  assert.deepEqual(sortedNames(rows, "manaValue"), ["Mountain", "Bolt"]);
});

test("rarity sorts most notable first", () => {
  const rows = [
    row({ name: "Common", rarity: "common" }),
    row({ name: "Mythic", rarity: "mythic" }),
    row({ name: "Uncommon", rarity: "uncommon" }),
    row({ name: "Rare", rarity: "rare" }),
  ];
  assert.deepEqual(sortedNames(rows, "rarity"), ["Mythic", "Rare", "Uncommon", "Common"]);
});

test("colour puts multicolour first, then WUBRG, then colourless", () => {
  const rows = [
    row({ name: "Colorless", colors: [] }),
    row({ name: "Green", colors: ["G"] }),
    row({ name: "White", colors: ["W"] }),
    row({ name: "Gold", colors: ["R", "G"] }),
  ];
  assert.deepEqual(sortedNames(rows, "color"), ["Gold", "White", "Green", "Colorless"]);
});

test("colour rank is explicit about its ordering", () => {
  assert.equal(colorRank(["R", "G"]), 0, "multicolour leads");
  assert.ok(colorRank(["W"]) < colorRank(["U"]));
  assert.ok(colorRank(["G"]) < colorRank([]), "colourless is last");
  assert.equal(colorRank(null), colorRank([]), "no colours is colourless");
});

// ---------------------------------------------------------------------------
// Mana symbols
// ---------------------------------------------------------------------------

test("mana costs split into symbols", () => {
  assert.deepEqual(manaSymbols("{2}{G}{G}"), ["2", "G", "G"]);
  assert.deepEqual(manaSymbols("{X}{R}{R}"), ["X", "R", "R"]);
  assert.deepEqual(manaSymbols(""), []);
  assert.deepEqual(manaSymbols(null), []);
});

test("hybrid and Phyrexian symbols survive whole", () => {
  assert.deepEqual(manaSymbols("{R/G}{U/P}"), ["R/G", "U/P"]);
});

test("split/adventure/flip costs only show the first face", () => {
  // Adventure: "Bonecrusher Giant // Stomp"-shaped cost.
  assert.deepEqual(manaSymbols("{2}{R} // {1}{R}"), ["2", "R"]);
  // True split: "Fire // Ice" -- deliberately less than the full printed cost.
  assert.deepEqual(manaSymbols("{1}{R} // {1}{U}"), ["1", "R"]);
  // No space around "//" is still read the same way.
  assert.deepEqual(manaSymbols("{X}{G}//{G}"), ["X", "G"]);
});

// ---------------------------------------------------------------------------
// Commander
// ---------------------------------------------------------------------------

test("the nominated commander gets its own section, ahead of everything", () => {
  const boss = row({ name: "Atarka", type_line: "Legendary Creature — Dragon" });
  const groups = groupDeck(
    [boss, row({ name: "Bear", type_line: "Creature — Bear" }), row({ name: "Bolt", type_line: "Instant" })],
    "name",
    boss.id,
  );

  assert.equal(groups[0].section, "commander");
  assert.deepEqual(
    groups[0].rows.map((r) => r.cards?.name),
    ["Atarka"],
  );
  assert.deepEqual(
    groups[1].rows.map((r) => r.cards?.name),
    ["Bear"],
    "the commander has left the creature section",
  );
});

test("no nomination means no commander section", () => {
  const groups = groupDeck([row({ name: "Bear", type_line: "Creature — Bear" })], "name", null);
  assert.equal(groups.some((g) => g.section === "commander"), false);
});

test("a nomination pointing at a card that is no longer here is ignored", () => {
  const groups = groupDeck(
    [row({ name: "Bear", type_line: "Creature — Bear" })],
    "name",
    "some-other-instance",
  );
  assert.deepEqual(
    groups.map((g) => g.section),
    ["creatures"],
    "no empty Commander heading",
  );
});

test("the commander is still counted once, in its own section", () => {
  const boss = row({ name: "Atarka", type_line: "Legendary Creature — Dragon" });
  const groups = groupDeck([boss], "name", boss.id);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].cardCount, 1);
});

// ---------------------------------------------------------------------------
// The Commander heading a deck keeps even when empty
// ---------------------------------------------------------------------------

test("alwaysIncludeCommander keeps the heading when nothing is nominated", () => {
  const groups = groupDeck([row({ name: "Bear", type_line: "Creature — Bear" })], "name", null, {
    alwaysIncludeCommander: true,
  });

  assert.deepEqual(
    groups.map((g) => g.section),
    ["commander", "creatures"],
    "Commander leads, as it does when one is chosen",
  );

  const commander = groups[0];
  assert.deepEqual(commander.rows, [], "no rows to show");
  assert.equal(commander.cardCount, 0, "and nothing to count");
});

test("without the option an empty Commander section stays absent", () => {
  const groups = groupDeck([row({ name: "Bear", type_line: "Creature — Bear" })], "name", null);
  assert.deepEqual(groups.map((g) => g.section), ["creatures"]);
});

test("the option changes nothing once a commander is nominated", () => {
  const boss = row({ name: "Atarka", type_line: "Legendary Creature — Dragon" });
  const bear = row({ name: "Bear", type_line: "Creature — Bear" });

  const withOption = groupDeck([boss, bear], "name", boss.id, { alwaysIncludeCommander: true });
  const without = groupDeck([boss, bear], "name", boss.id);

  assert.deepEqual(
    withOption.map((g) => [g.section, g.cardCount]),
    without.map((g) => [g.section, g.cardCount]),
  );
  assert.equal(withOption[0].section, "commander");
  assert.equal(withOption[0].rows[0].id, boss.id, "the nominated card, not a placeholder");
});
