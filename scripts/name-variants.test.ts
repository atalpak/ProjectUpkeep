/**
 * The spellings a two-part card's name arrives in.
 *
 * The bug these guard: a decklist line reading "Lorehold Archivist / Restore
 * Relic" matched nothing, because the database stores "Lorehold Archivist //
 * Restore Relic".
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { faces, frontFace, nameVariants } from "../src/lib/import/name-variants";

test("a plain name is its own only variant", () => {
  assert.deepEqual(nameVariants("Lightning Bolt"), ["Lightning Bolt"]);
  assert.deepEqual(nameVariants("  Sol Ring  "), ["Sol Ring"]);
});

test("a single-slash name also offers the canonical double-slash form", () => {
  assert.deepEqual(nameVariants("Lorehold Archivist / Restore Relic"), [
    "Lorehold Archivist / Restore Relic",
    "Lorehold Archivist // Restore Relic",
    "Lorehold Archivist",
  ]);
});

test("a name already in canonical form does not repeat itself", () => {
  const variants = nameVariants("Fire // Ice");
  assert.deepEqual(variants, ["Fire // Ice", "Fire"]);
  assert.equal(new Set(variants).size, variants.length, "no duplicates");
});

test("slashes without surrounding spaces are handled", () => {
  assert.deepEqual(nameVariants("Fire//Ice"), ["Fire//Ice", "Fire // Ice", "Fire"]);
  assert.deepEqual(nameVariants("Fire/Ice"), ["Fire/Ice", "Fire // Ice", "Fire"]);
});

test("a card with more than two faces keeps all of them in order", () => {
  assert.deepEqual(faces("Who // What // When // Where // Why"), [
    "Who",
    "What",
    "When",
    "Where",
    "Why",
  ]);
  assert.equal(
    nameVariants("Who / What / When / Where / Why")[1],
    "Who // What // When // Where // Why",
  );
});

test("frontFace is the half exporters abbreviate to", () => {
  assert.equal(frontFace("Lorehold Archivist // Restore Relic"), "Lorehold Archivist");
  assert.equal(frontFace("Kirol, History Buff / Pack a Punch"), "Kirol, History Buff");
  assert.equal(frontFace("Lightning Bolt"), "Lightning Bolt");
});

test("a comma in a face name survives the split", () => {
  assert.deepEqual(nameVariants("Kirol, History Buff / Pack a Punch"), [
    "Kirol, History Buff / Pack a Punch",
    "Kirol, History Buff // Pack a Punch",
    "Kirol, History Buff",
  ]);
});

test("empty and slash-only input degrade quietly", () => {
  assert.deepEqual(nameVariants(""), []);
  assert.deepEqual(nameVariants("   "), []);
  assert.deepEqual(nameVariants("//"), ["//"]);
});
