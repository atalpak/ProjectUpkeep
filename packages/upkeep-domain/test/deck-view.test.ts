/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import { groupDeck, sectionFor } from "../src/deck-view";

test("a card lands in one section, under its most specific type", () => {
  assert.equal(sectionFor("Artifact Land"), "lands");
  assert.equal(sectionFor("Legendary Artifact Creature — Golem"), "creatures");
  assert.equal(sectionFor("Enchantment Creature — Nymph"), "creatures");
  assert.equal(sectionFor("Legendary Planeswalker — Jace"), "planeswalkers");
  assert.equal(sectionFor("Instant"), "instants");
  assert.equal(sectionFor(null), "other");
});

test("a double-faced card is sorted by its front face", () => {
  assert.equal(sectionFor("Creature — Human // Land"), "creatures");
  assert.equal(sectionFor("Land // Creature — Elemental"), "lands");
});

test("groups come out in display order, sorted by name, with counts, and empty ones left out", () => {
  const entries = [
    { id: "1", quantity: 1, name: "Sol Ring", typeLine: "Artifact" },
    { id: "2", quantity: 4, name: "Mountain", typeLine: "Basic Land — Mountain" },
    { id: "3", quantity: 2, name: "Goblin Guide", typeLine: "Creature — Goblin" },
    { id: "4", quantity: 1, name: "Atarka", typeLine: "Legendary Creature — Dragon" },
  ];
  const groups = groupDeck(entries);
  assert.deepEqual(groups.map((g) => g.section), ["creatures", "artifacts", "lands"]);
  assert.deepEqual(groups[0]!.rows.map((r) => r.name), ["Atarka", "Goblin Guide"]);
  assert.equal(groups[0]!.count, 3);
  assert.equal(groups[2]!.count, 4);
});

test("the commander is pulled out into its own first section", () => {
  const entries = [
    { id: "1", quantity: 1, name: "Atarka", typeLine: "Legendary Creature — Dragon" },
    { id: "2", quantity: 1, name: "Goblin Guide", typeLine: "Creature — Goblin" },
  ];
  const groups = groupDeck(entries, "1");
  assert.deepEqual(groups.map((g) => g.section), ["commander", "creatures"]);
  assert.deepEqual(groups[0]!.rows.map((r) => r.name), ["Atarka"]);
});
