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
