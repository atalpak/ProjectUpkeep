/**
 * Tests for the oracle_cards mapper, fingerprint, diff and stream.
 *
 * The one that matters most is the parity test: every value the oracle mapper
 * produces must equal what toCardRow puts in the same `cards` column for the
 * same card, double-faced cards included, because readers will move from one
 * table to the other and a Delver of Secrets must not change what it says.
 *
 * Run with: npx tsx --test scripts/scryfall-oracle.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

import { toCardRow } from "../src/lib/scryfall";
import {
  MIN_ORACLE_CARDS,
  ORACLE_COLUMNS,
  checkOracleFeedComplete,
  compactLegalities,
  hashOracleRow,
  planOracleWrites,
  streamOracleRows,
  toOracleRow,
  type OracleRow,
  type ScryfallOracleCard,
} from "../src/lib/scryfall-oracle";

const SYNCED_AT = "2026-01-01T00:00:00.000Z";

const bolt: ScryfallOracleCard = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  oracle_id: "ffffffff-0000-0000-0000-000000000001",
  name: "Lightning Bolt",
  set: "lea",
  collector_number: "161",
  mana_cost: "{R}",
  cmc: 1,
  type_line: "Instant",
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  colors: ["R"],
  color_identity: ["R"],
  keywords: [],
  layout: "normal",
  game_changer: false,
  legalities: {
    standard: "not_legal",
    modern: "legal",
    legacy: "legal",
    vintage: "legal",
    commander: "legal",
    pauper: "not_legal",
  },
};

// A transform card: no top-level cost, text, colours or stats, only faces.
const delver: ScryfallOracleCard = {
  id: "aaaaaaaa-0000-0000-0000-000000000002",
  oracle_id: "ffffffff-0000-0000-0000-000000000002",
  name: "Delver of Secrets // Insectile Aberration",
  set: "isd",
  collector_number: "51",
  cmc: 1,
  type_line: "Creature — Human Wizard // Creature — Human Insect",
  color_identity: ["U"],
  keywords: ["Flying", "Transform"],
  layout: "transform",
  legalities: { modern: "legal", standard: "not_legal" },
  card_faces: [
    {
      name: "Delver of Secrets",
      mana_cost: "{U}",
      type_line: "Creature — Human Wizard",
      oracle_text: "At the beginning of your upkeep, look at the top card of your library.",
      colors: ["U"],
      power: "1",
      toughness: "1",
    },
    {
      name: "Insectile Aberration",
      type_line: "Creature — Human Insect",
      oracle_text: "Flying",
      colors: ["U"],
      power: "3",
      toughness: "2",
    },
  ],
};

// An MDFC land: produced_mana only on the front face.
const mdfcLand: ScryfallOracleCard = {
  id: "aaaaaaaa-0000-0000-0000-000000000003",
  oracle_id: "ffffffff-0000-0000-0000-000000000003",
  name: "Front // Back",
  set: "znr",
  collector_number: "1",
  cmc: 0,
  type_line: "Land // Land",
  color_identity: ["G"],
  layout: "modal_dfc",
  game_changer: true,
  card_faces: [
    { name: "Front", type_line: "Land", oracle_text: "{T}: Add {G}.", produced_mana: ["G"], loyalty: "3" },
    { name: "Back", type_line: "Land", oracle_text: "{T}: Add {U}.", produced_mana: ["U"] },
  ],
};

test("maps a single-faced card", () => {
  const row = toOracleRow(bolt)!;
  assert.equal(row.oracle_id, bolt.oracle_id);
  assert.equal(row.name, "Lightning Bolt");
  assert.equal(row.cmc, 1);
  assert.equal(row.mana_cost, "{R}");
  assert.deepEqual(row.colors, ["R"]);
  assert.equal(row.game_changer, false);
  assert.equal(row.layout, "normal");
});

test("legalities are compact: not_legal entries are omitted, keys sorted", () => {
  assert.deepEqual(toOracleRow(bolt)!.legalities, {
    commander: "legal",
    legacy: "legal",
    modern: "legal",
    vintage: "legal",
  });
  assert.equal("standard" in toOracleRow(bolt)!.legalities, false);
  assert.deepEqual(
    compactLegalities({ b: "banned", a: "restricted", c: "not_legal", d: "" }),
    { a: "restricted", b: "banned" },
  );
  assert.deepEqual(compactLegalities(undefined), {});
  assert.deepEqual(compactLegalities(null), {});
});

test("PARITY: every shared column equals what toCardRow stores in cards", () => {
  for (const card of [bolt, delver, mdfcLand]) {
    const oracle = toOracleRow(card)!;
    const printing = toCardRow(card, SYNCED_AT)!;
    for (const column of [
      "oracle_id",
      "name",
      "mana_cost",
      "cmc",
      "type_line",
      "oracle_text",
      "colors",
      "color_identity",
      "keywords",
      "power",
      "toughness",
      "loyalty",
      "produced_mana",
      "game_changer",
      "layout",
    ] as const) {
      assert.deepEqual(
        oracle[column],
        printing[column],
        `${card.name}: oracle_cards.${column} must equal cards.${column}`,
      );
    }
  }
});

test("double-faced cards fall back to the front face, and only the front face", () => {
  const row = toOracleRow(delver)!;
  assert.equal(row.mana_cost, "{U}");
  assert.equal(row.oracle_text, "At the beginning of your upkeep, look at the top card of your library.");
  assert.deepEqual(row.colors, ["U"]);
  assert.equal(row.power, "1");
  assert.equal(row.toughness, "1");

  const land = toOracleRow(mdfcLand)!;
  assert.deepEqual(land.produced_mana, ["G"]);
  assert.equal(land.loyalty, "3");
  assert.equal(land.cmc, 0, "a real 0 must not become null");
  assert.equal(land.game_changer, true);
});

test("absent fields are null, not undefined or empty", () => {
  const row = toOracleRow({ ...bolt, mana_cost: undefined, oracle_text: undefined, cmc: undefined, game_changer: undefined })!;
  assert.equal(row.mana_cost, null);
  assert.equal(row.oracle_text, null);
  assert.equal(row.cmc, null);
  assert.equal(row.game_changer, null);
  // ...but an empty oracle_text is a real value and stays one.
  assert.equal(toOracleRow({ ...bolt, oracle_text: "" })!.oracle_text, "");
});

test("oracle_id falls back to the front face (reversible cards), else the record is unusable", () => {
  const reversible = { ...delver, oracle_id: undefined, card_faces: [{ ...delver.card_faces![0], oracle_id: "ffffffff-0000-0000-0000-0000000000aa" }, delver.card_faces![1]] };
  assert.equal(toOracleRow(reversible)!.oracle_id, "ffffffff-0000-0000-0000-0000000000aa");
  assert.equal(toOracleRow({ ...bolt, oracle_id: undefined }), null);
  assert.equal(toOracleRow({ ...bolt, name: "" }), null);
});

test("ORACLE_COLUMNS lists every field of a mapped row, exactly once", () => {
  const row = toOracleRow(bolt)!;
  assert.deepEqual([...ORACLE_COLUMNS].sort(), Object.keys(row).sort());
  assert.equal(new Set(ORACLE_COLUMNS).size, ORACLE_COLUMNS.length);
});

test("the fingerprint is stable, and moves with any loaded field", () => {
  const a = toOracleRow(bolt)!;
  assert.match(a.content_hash, /^[0-9a-f]{20}$/);
  assert.equal(toOracleRow({ ...bolt })!.content_hash, a.content_hash);
  // Key order in the input must not matter: the legalities are sorted.
  const reordered = { ...bolt, legalities: { commander: "legal", vintage: "legal", legacy: "legal", modern: "legal" } };
  assert.equal(toOracleRow(reordered)!.content_hash, a.content_hash);

  const changes: Partial<ScryfallOracleCard>[] = [
    { oracle_text: "Lightning Bolt deals 4 damage to any target." },
    { type_line: "Sorcery" },
    { cmc: 2 },
    { keywords: ["Haste"] },
    { legalities: { ...bolt.legalities, modern: "banned" } },
    { game_changer: true },
    { layout: "split" },
  ];
  for (const change of changes) {
    assert.notEqual(
      toOracleRow({ ...bolt, ...change })!.content_hash,
      a.content_hash,
      `changing ${Object.keys(change)[0]} must change the hash`,
    );
  }
  // A format going not_legal -> absent is not a change; legal -> banned is.
  assert.equal(
    toOracleRow({ ...bolt, legalities: { ...bolt.legalities, pioneer: "not_legal" } })!.content_hash,
    a.content_hash,
  );
  // null and '' are different values and must hash differently.
  assert.notEqual(
    hashOracleRow({ ...a, oracle_text: null }),
    hashOracleRow({ ...a, oracle_text: "" }),
  );
});

test("planOracleWrites separates new and changed rows from ones already stored exactly", () => {
  const rows = [bolt, delver, mdfcLand].map((c) => toOracleRow(c)!);
  const stored = new Map<string, string | null>([
    [rows[0].oracle_id, rows[0].content_hash], // identical -> unchanged
    [rows[1].oracle_id, "stale-hash"], // differs -> changed
    // rows[2] absent -> new
  ]);
  const plan = planOracleWrites(rows, stored);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.changed.map((r) => r.oracle_id), [rows[1].oracle_id, rows[2].oracle_id]);

  // A stored null hash means "never fingerprinted": rewrite it.
  assert.equal(planOracleWrites([rows[0]], new Map([[rows[0].oracle_id, null]])).changed.length, 1);
});

test("checkOracleFeedComplete: absolute floor first, then half of what is stored", () => {
  assert.equal(checkOracleFeedComplete(38_900, 38_906), null);
  assert.equal(checkOracleFeedComplete(MIN_ORACLE_CARDS, 0), null, "a first load at the floor is fine");
  assert.equal(checkOracleFeedComplete(38_900, 0), null, "a full first load is fine");
  // The gap this closes: with an empty table there is nothing to compare to,
  // and a truncated first load must not be recorded as succeeded.
  assert.match(checkOracleFeedComplete(100, 0)!, /truncated/);
  assert.match(checkOracleFeedComplete(MIN_ORACLE_CARDS - 1, 0)!, /truncated/);
  // Above the floor but under half of what is stored.
  assert.match(checkOracleFeedComplete(20_500, 60_000)!, /are stored/);
  assert.equal(checkOracleFeedComplete(30_000, 60_000), null);
});

test("the printings sync never touches oracle_cards (which is why migration 43 revokes service_role writes)", () => {
  const source = readFileSync(new URL("./sync-scryfall.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /oracle_cards/);
  assert.doesNotMatch(source, /scryfall-oracle/);
});

const jsonl = (cards: unknown[]) => Readable.from([cards.map((c) => JSON.stringify(c)).join("\n") + "\n"]);

test("streamOracleRows batches, skips unusable records, and drops repeated oracle ids", async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({
    ...bolt,
    id: `aaaaaaaa-0000-0000-0000-00000000010${i}`,
    oracle_id: `ffffffff-0000-0000-0000-00000000010${i}`,
    name: `Card ${i}`,
  }));
  const feed = [...many, { ...many[0], name: "Repeat of card 0" }, { ...bolt, oracle_id: undefined }, { name: "no ids at all" }];

  const batches: OracleRow[][] = [];
  const result = await streamOracleRows(jsonl(feed), {
    batchSize: 2,
    onBatch: async (rows) => void batches.push(rows),
  });

  assert.deepEqual(batches.map((b) => b.length), [2, 2, 1]);
  assert.equal(result.processed, 5);
  assert.equal(result.skipped, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(batches.flat()[0].name, "Card 0", "the first occurrence wins");
});

test("streamOracleRows rethrows the sink's own error, not pipeline's generic abort", async () => {
  await assert.rejects(
    streamOracleRows(jsonl([bolt, delver, mdfcLand]), {
      batchSize: 1,
      onBatch: async () => {
        throw new Error("statement timeout");
      },
    }),
    /statement timeout/,
  );
});

test("streamOracleRows validates batchSize", async () => {
  await assert.rejects(
    streamOracleRows(jsonl([bolt]), { batchSize: 0, onBatch: async () => {} }),
    /batchSize/,
  );
});
