/**
 * Tests for the Scryfall -> cards mapping. Pure functions, no network or DB.
 *
 * Run with: npx tsx --test scripts/sync-scryfall.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { toCardRow, type ScryfallCard } from "../src/lib/scryfall";

const SYNCED_AT = "2026-01-01T00:00:00.000Z";

const baseCard: ScryfallCard = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  oracle_id: "ffffffff-0000-0000-0000-000000000001",
  name: "Lightning Bolt",
  set: "m10",
  set_name: "Magic 2010",
  collector_number: "146",
  rarity: "common",
  type_line: "Instant",
  released_at: "2009-07-17",
  lang: "en",
  finishes: ["nonfoil", "foil"],
  image_uris: { small: "https://img/small", normal: "https://img/normal" },
};

test("maps a plain single-faced card", () => {
  const row = toCardRow(baseCard, SYNCED_AT);
  assert.ok(row);
  assert.equal(row.scryfall_id, baseCard.id);
  assert.equal(row.set_code, "m10");
  assert.equal(row.image_uri, "https://img/normal");
  assert.equal(row.image_uri_small, "https://img/small");
  assert.deepEqual(row.available_finishes, ["nonfoil", "foil"]);
  assert.equal(row.digital, false);
  assert.equal(row.last_synced_at, SYNCED_AT);
});

test("takes images from the front face of a double-faced card", () => {
  const row = toCardRow(
    {
      ...baseCard,
      image_uris: undefined,
      card_faces: [
        { image_uris: { small: "https://front/small", normal: "https://front/normal" } },
        { image_uris: { small: "https://back/small", normal: "https://back/normal" } },
      ],
    },
    SYNCED_AT,
  );
  assert.ok(row);
  assert.equal(row.image_uri, "https://front/normal");
  assert.equal(row.image_uri_small, "https://front/small");
});

test("falls back to a face oracle_id for reversible cards", () => {
  const row = toCardRow(
    {
      ...baseCard,
      oracle_id: undefined,
      card_faces: [{ oracle_id: "ffffffff-0000-0000-0000-00000000000f" }],
    },
    SYNCED_AT,
  );
  assert.ok(row);
  assert.equal(row.oracle_id, "ffffffff-0000-0000-0000-00000000000f");
});

test("drops finishes outside our CHECK vocabulary", () => {
  const row = toCardRow(
    { ...baseCard, finishes: ["nonfoil", "surge_foil_from_the_future"] },
    SYNCED_AT,
  );
  assert.ok(row);
  assert.deepEqual(row.available_finishes, ["nonfoil"]);
});

test("defaults to nonfoil when no usable finish survives", () => {
  const row = toCardRow({ ...baseCard, finishes: [] }, SYNCED_AT);
  assert.ok(row);
  assert.deepEqual(row.available_finishes, ["nonfoil"]);
});

test("tolerates a card with no images at all", () => {
  const row = toCardRow({ ...baseCard, image_uris: undefined }, SYNCED_AT);
  assert.ok(row);
  assert.equal(row.image_uri, null);
  assert.equal(row.image_uri_small, null);
});

test("rejects records missing the fields our NOT NULL columns need", () => {
  assert.equal(toCardRow({ ...baseCard, id: "" }, SYNCED_AT), null);
  assert.equal(toCardRow({ ...baseCard, name: "" }, SYNCED_AT), null);
  assert.equal(toCardRow({ ...baseCard, set: "" }, SYNCED_AT), null);
  assert.equal(toCardRow({ ...baseCard, collector_number: "" }, SYNCED_AT), null);
});

test("preserves digital-only printings but marks them", () => {
  const row = toCardRow({ ...baseCard, digital: true, set: "ana" }, SYNCED_AT);
  assert.ok(row);
  assert.equal(row.digital, true);
});

// ---------------------------------------------------------------------------
// Detail columns (migration 00000000000007)
// ---------------------------------------------------------------------------

test("maps the detail columns off a single-faced card", () => {
  const row = toCardRow(
    {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Lightning Bolt",
      set: "lea",
      set_name: "Limited Edition Alpha",
      set_type: "core",
      collector_number: "161",
      layout: "normal",
      mana_cost: "{R}",
      cmc: 1,
      oracle_text: "Lightning Bolt deals 3 damage to any target.",
      flavor_text: "The sparkmage shrieked…",
      colors: ["R"],
      color_identity: ["R"],
      keywords: [],
      artist: "Christopher Rush",
    },
    SYNCED_AT,
  );

  assert.ok(row);
  assert.equal(row.mana_cost, "{R}");
  assert.equal(row.cmc, 1);
  assert.equal(row.oracle_text, "Lightning Bolt deals 3 damage to any target.");
  assert.deepEqual(row.colors, ["R"]);
  assert.deepEqual(row.color_identity, ["R"]);
  assert.equal(row.artist, "Christopher Rush");
  assert.equal(row.set_type, "core");
  assert.equal(row.layout, "normal");
  assert.equal(row.card_faces, null, "a single-faced card stores no faces");
});

test("takes cost and rules text from the front face of a transform card", () => {
  // Transform cards carry no top-level mana_cost, oracle_text, colors or stats
  // at all — verified against Scryfall's own data for this card.
  const row = toCardRow(
    {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki",
      set: "neo",
      collector_number: "141",
      layout: "transform",
      cmc: 3,
      color_identity: ["R"],
      artist: "Joseph Meehan",
      card_faces: [
        {
          name: "Fable of the Mirror-Breaker",
          mana_cost: "{2}{R}",
          oracle_text: "Create a 2/2 red Goblin Shaman creature token.",
          colors: ["R"],
          type_line: "Enchantment — Saga",
        },
        {
          name: "Reflection of Kiki-Jiki",
          mana_cost: "",
          oracle_text: "{1}, {T}: Create a token that's a copy…",
          power: "2",
          toughness: "2",
          type_line: "Enchantment Creature — Goblin Shaman",
        },
      ],
    },
    SYNCED_AT,
  );

  assert.ok(row);
  assert.equal(row.mana_cost, "{2}{R}", "front face's cost");
  assert.match(row.oracle_text ?? "", /Goblin Shaman creature token/);
  assert.deepEqual(row.colors, ["R"], "colours come from the face too");
  assert.equal(row.cmc, 3, "but cmc stays top-level");
  assert.equal(row.power, null, "the front face is not a creature");
  assert.equal(row.card_faces?.length, 2, "both faces are kept for the panel");
});

test("keeps a planeswalker's loyalty", () => {
  const row = toCardRow(
    {
      id: "33333333-3333-3333-3333-333333333333",
      name: "Jace, the Mind Sculptor",
      set: "wwk",
      collector_number: "31",
      loyalty: "3",
      mana_cost: "{2}{U}{U}",
    },
    SYNCED_AT,
  );
  assert.equal(row?.loyalty, "3");
});

test("a zero mana value is kept, not turned into null", () => {
  const row = toCardRow(
    { id: "44444444-4444-4444-4444-444444444444", name: "Ornithopter", set: "atq", collector_number: "83", cmc: 0 },
    SYNCED_AT,
  );
  assert.equal(row?.cmc, 0, "0 is a real mana value");
});
