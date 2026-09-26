import { test } from "node:test";
import assert from "node:assert/strict";

import { foldOwnership } from "../src/lib/cards/search-enrichment-core";
import { catalogCardToPanelCard } from "../src/lib/cards/catalog-panel-card";
import type { CatalogCard } from "@upkeep/domain";

test("ownership: exact printing vs another printing of the same card, never by name", () => {
  const out = foldOwnership(
    [{ id: "p1", oracleId: "o1" }, { id: "p2", oracleId: "o1" }, { id: "p3", oracleId: "o9" }, { id: "p4", oracleId: null }],
    [{ card_id: "p1", oracle_id: "o1", quantity: 2 }, { card_id: "p5", oracle_id: "o1", quantity: 1 }, { card_id: "p4", oracle_id: null, quantity: 1 }],
  );
  assert.deepEqual(out.p1, { exact: 2, otherPrintings: 1 });
  assert.deepEqual(out.p2, { exact: 0, otherPrintings: 3 });
  assert.equal(out.p3, undefined);
  assert.deepEqual(out.p4, { exact: 1, otherPrintings: 0 });
});

test("panel card: missing data stays null, prices parse, faces carry over", () => {
  const c: CatalogCard = {
    id: "x", oracleId: null, name: "A // B", lang: "ja", games: ["arena"], set: "neo", setName: "Neon", collectorNumber: "1",
    releasedAt: "2022-02-18", layout: "transform", rarity: "rare", prices: { usd: "1.50", usd_foil: null, eur: null, tix: null },
    imageNormal: "n", imageLarge: null, imageSmall: "s", scryfallUri: "u", digital: true,
    faces: [{ name: "A", imageNormal: "n", imageLarge: null, imageSmall: "s", power: "2" }, { name: "B", imageNormal: "n2", imageLarge: null, imageSmall: null }],
  };
  const p = catalogCardToPanelCard(c);
  assert.equal(p.scryfall_id, "x");
  assert.equal(p.oracle_id, null);
  assert.equal(p.price_usd, 1.5);
  assert.equal(p.price_usd_foil, null);
  assert.equal(p.card_faces?.length, 2);
  assert.equal(p.power, "2");
  assert.deepEqual(p.available_finishes, []);
  assert.equal(p.digital, true);
});

test("panel card marks upstream-only printings with an empty last_synced_at", () => {
  const base = { id: "x", oracleId: null, name: "N", lang: "en", games: [], set: "s", setName: "S", collectorNumber: "1", releasedAt: "", layout: "normal", rarity: "", prices: { usd: null, usd_foil: null, eur: null, tix: null }, imageNormal: null, imageLarge: null, imageSmall: null, scryfallUri: "", digital: false, faces: [] } as CatalogCard;
  assert.equal(catalogCardToPanelCard(base, false).last_synced_at, "");
  assert.notEqual(catalogCardToPanelCard(base, true).last_synced_at, "");
});
