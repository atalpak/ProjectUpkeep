import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkAuxiliaryFeedSize,
  toOracleRuling,
  toOracleTag,
} from "../src/lib/scryfall-auxiliary";

const ORACLE_ID = "00037840-6089-42ec-8c5c-281f9f474504";
const TAG_ID = "00155182-3099-4742-be68-f8b4ea259d78";

test("oracle tag mapping preserves identity, hierarchy, aliases, and card weights", () => {
  const tag = toOracleTag({
    object: "tag", type: "oracle", id: TAG_ID,
    label: "Tutor Giant", slug: "tutor-creature-giant",
    description: "Cards that tutor Giants.", uri: "https://tagger.scryfall.com/tags/card/tutor-creature-giant",
    aliases: ["tutor-giant"], parent_ids: [ORACLE_ID], child_ids: [],
    taggings: [{ oracle_id: ORACLE_ID, weight: "median" }],
  });
  assert.equal(tag.id, TAG_ID);
  assert.equal(tag.slug, "tutor-creature-giant");
  assert.deepEqual(tag.aliases, ["tutor-giant"]);
  assert.deepEqual(tag.parent_ids, [ORACLE_ID]);
  assert.deepEqual(tag.taggings, [{ oracle_id: ORACLE_ID, weight: "median" }]);
});

test("oracle tag mapping rejects duplicate card links and malformed records", () => {
  const base = {
    object: "tag", type: "oracle", id: TAG_ID, label: "Example", slug: "example",
    aliases: [], parent_ids: [], child_ids: [],
    taggings: [{ oracle_id: ORACLE_ID, weight: "median" }],
  };
  assert.throws(() => toOracleTag({ ...base, taggings: [...base.taggings, ...base.taggings] }), /Duplicate/);
  assert.throws(() => toOracleTag({ ...base, id: "bad" }), /Invalid tag.id/);
  assert.throws(() => toOracleTag({ ...base, taggings: null }), /Invalid taggings/);
});

test("ruling hashes deduplicate identical lines and change when the text changes", () => {
  const source = {
    object: "ruling", oracle_id: ORACLE_ID, source: "wotc",
    published_at: "2025-02-07", comment: "Pay {E} once.",
  };
  const first = toOracleRuling(source);
  assert.equal(first.oracle_id, ORACLE_ID);
  assert.match(first.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(toOracleRuling({ ...source }).content_hash, first.content_hash);
  assert.notEqual(toOracleRuling({ ...source, comment: "Pay {E} twice." }).content_hash, first.content_hash);
  assert.equal(toOracleRuling({ ...source, comment: "\u00a0" }).comment, "\u00a0");
  assert.throws(() => toOracleRuling({ ...source, published_at: "bad" }), /published_at/);
  assert.throws(() => toOracleRuling({ ...source, published_at: "2025-02-31" }), /published_at/);
});

test("short feeds are refused before a replacement can delete existing rows", () => {
  assert.doesNotThrow(() => checkAuxiliaryFeedSize("tags", 4560, 4500, 3000));
  assert.throws(() => checkAuxiliaryFeedSize("tags", 2500, 0, 3000), /refusing to remove/);
  assert.throws(() => checkAuxiliaryFeedSize("tags", 3500, 4560, 3000), /refusing to remove/);
});
