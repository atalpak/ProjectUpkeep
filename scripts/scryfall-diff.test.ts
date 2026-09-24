/**
 * The sync's "what changed" logic: fingerprints, the write plan, and the
 * keyset read of stored hashes. Pure functions plus an injected page fetcher,
 * so no database is involved.
 *
 * The behaviour that matters is the split between a price change and any other
 * change, because it decides whether prices_updated_at moves.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { toCardRow, type CardRow, type ScryfallCard } from "../src/lib/scryfall";
import {
  catalogMayBeStale,
  checkHashReadComplete,
  fingerprint,
  formatHash,
  loadExistingHashes,
  parseHash,
  planWrites,
  shouldPublishCatalog,
  type HashPage,
} from "../src/lib/scryfall-diff";

const DAY_1 = "2026-09-22T09:15:00.000Z";
const DAY_2 = "2026-09-23T09:15:00.000Z";

const bolt: ScryfallCard = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  oracle_id: "ffffffff-0000-0000-0000-000000000001",
  name: "Lightning Bolt",
  set: "m10",
  collector_number: "146",
  type_line: "Instant",
  finishes: ["nonfoil", "foil"],
  image_uris: { small: "https://img/small", normal: "https://img/normal" },
  prices: { usd: "1.50", usd_foil: "4.00" },
  card_faces: [
    { name: "A", oracle_text: "one", image_uris: { small: "s" } },
    { name: "B", oracle_text: "two" },
  ],
};

const row = (card: ScryfallCard = bolt, syncedAt = DAY_1): CardRow => {
  const mapped = toCardRow(card, syncedAt);
  assert.ok(mapped);
  return mapped;
};

/** What the database would hold after the sync wrote `r`. */
const stored = (r: CardRow) => formatHash(fingerprint(r));

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

test("the run's timestamps are not part of the fingerprint", () => {
  // If they were, every row would differ every day and nothing would be skipped.
  assert.deepEqual(fingerprint(row(bolt, DAY_1)), fingerprint(row(bolt, DAY_2)));
});

test("a price change moves the price hash and leaves the metadata hash alone", () => {
  const before = fingerprint(row());
  const after = fingerprint(row({ ...bolt, prices: { usd: "1.75", usd_foil: "4.00" } }));
  assert.notEqual(after.prices, before.prices);
  assert.equal(after.meta, before.meta);
});

test("a non-price change moves the metadata hash and leaves the price hash alone", () => {
  const before = fingerprint(row());
  const after = fingerprint(row({ ...bolt, type_line: "Instant — Arcane" }));
  assert.notEqual(after.meta, before.meta);
  assert.equal(after.prices, before.prices);
});

test("every price column is covered by the price hash", () => {
  const base = fingerprint(row());
  for (const key of ["usd", "usd_foil", "usd_etched", "eur", "eur_foil"] as const) {
    const changed = fingerprint(row({ ...bolt, prices: { ...bolt.prices, [key]: "9.99" } }));
    assert.notEqual(changed.prices, base.prices, `${key} must count as a price change`);
    assert.equal(changed.meta, base.meta, `${key} must not count as a metadata change`);
  }
});

test("nested JSON hashes the same whatever order its keys arrive in", () => {
  const reordered: ScryfallCard = {
    ...bolt,
    card_faces: [
      { image_uris: { small: "s" }, oracle_text: "one", name: "A" },
      { oracle_text: "two", name: "B" },
    ],
  };
  assert.deepEqual(fingerprint(row(reordered)), fingerprint(row()));
});

test("a change inside card_faces is noticed", () => {
  const edited: ScryfallCard = {
    ...bolt,
    card_faces: [bolt.card_faces![0], { name: "B", oracle_text: "changed" }],
  };
  assert.notEqual(fingerprint(row(edited)).meta, fingerprint(row()).meta);
});

test("parseHash round-trips and rejects anything malformed", () => {
  const fp = fingerprint(row());
  assert.deepEqual(parseHash(formatHash(fp)), fp);
  for (const bad of [null, undefined, "", "abc", "a.b.c", ".b", "a."]) {
    assert.equal(parseHash(bad), null, `${JSON.stringify(bad)} is not a stored hash`);
  }
});

// ---------------------------------------------------------------------------
// The write plan
// ---------------------------------------------------------------------------

test("an identical row is not written", () => {
  const existing = new Map([[bolt.id, stored(row())]]);
  const plan = planWrites([row(bolt, DAY_2)], existing);
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.full.length, 0);
  assert.equal(plan.metaOnly.length, 0);
});

test("a new printing is written whole, with its hash and prices_updated_at", () => {
  const plan = planWrites([row(bolt, DAY_2)], new Map());
  assert.equal(plan.full.length, 1);
  assert.equal(plan.full[0].prices_updated_at, DAY_2);
  assert.equal(plan.full[0].content_hash, stored(row()));
});

test("a price change is written whole, and advances prices_updated_at", () => {
  const existing = new Map([[bolt.id, stored(row())]]);
  const moved = { ...bolt, prices: { usd: "2.00", usd_foil: "4.00" } };
  const plan = planWrites([row(moved, DAY_2)], existing);
  assert.equal(plan.full.length, 1);
  assert.equal(plan.full[0].prices_updated_at, DAY_2);
  assert.equal(plan.metaOnly.length, 0);
});

test("a metadata-only change is written WITHOUT prices_updated_at", () => {
  // The whole reason for two hashes: an image URL edit must not make the UI
  // claim prices were refreshed today.
  const existing = new Map([[bolt.id, stored(row())]]);
  const plan = planWrites([row({ ...bolt, type_line: "Sorcery" }, DAY_2)], existing);
  assert.equal(plan.full.length, 0);
  assert.equal(plan.metaOnly.length, 1);
  assert.equal("prices_updated_at" in plan.metaOnly[0], false);
  assert.equal(plan.metaOnly[0].last_synced_at, DAY_2);
  assert.equal(plan.metaOnly[0].content_hash, formatHash(fingerprint(row({ ...bolt, type_line: "Sorcery" }))));
});

test("a change to both counts as a price change", () => {
  const existing = new Map([[bolt.id, stored(row())]]);
  const both = { ...bolt, type_line: "Sorcery", prices: { usd: "9.00" } };
  const plan = planWrites([row(both, DAY_2)], existing);
  assert.equal(plan.full.length, 1);
  assert.equal(plan.metaOnly.length, 0);
});

test("a row that was never fingerprinted is written whole", () => {
  // First run after migration 42: content_hash is null everywhere, and we
  // cannot know whether prices moved, so it takes the honest path.
  for (const legacy of [null, "garbage"]) {
    const plan = planWrites([row(bolt, DAY_2)], new Map([[bolt.id, legacy]]));
    assert.equal(plan.full.length, 1, `stored ${legacy} must be rewritten`);
  }
});

test("a mixed batch is split correctly and every row lands in exactly one bucket", () => {
  const other = (n: number): ScryfallCard => ({
    ...bolt,
    id: `aaaaaaaa-0000-0000-0000-00000000010${n}`,
    collector_number: `20${n}`,
  });
  const cards = [bolt, other(1), other(2), other(3)];
  const existing = new Map<string, string | null>([
    [cards[0].id, stored(row(cards[0]))], // unchanged
    [cards[1].id, stored(row(cards[1]))], // price will move
    [cards[2].id, stored(row(cards[2]))], // type line will move
    // cards[3] is new
  ]);
  const today = [
    cards[0],
    { ...cards[1], prices: { usd: "7.00" } },
    { ...cards[2], type_line: "Land" },
    cards[3],
  ].map((c) => row(c, DAY_2));

  const plan = planWrites(today, existing);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.full.map((r) => r.scryfall_id).sort(), [cards[1].id, cards[3].id].sort());
  assert.deepEqual(plan.metaOnly.map((r) => r.scryfall_id), [cards[2].id]);
});

test("planning does not mutate the incoming rows", () => {
  const input = row(bolt, DAY_2);
  const snapshot = JSON.stringify(input);
  planWrites([input], new Map());
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal("content_hash" in input, false);
});

// ---------------------------------------------------------------------------
// Reading the stored hashes
// ---------------------------------------------------------------------------

/** A fake table of ids `id-000`..`id-(n-1)`, served by keyset like the real query. */
function fakeTable(n: number, serverCap = Infinity) {
  const ids = Array.from({ length: n }, (_, i) => `id-${String(i).padStart(3, "0")}`);
  const calls: (string | null)[] = [];
  const fetchPage = async (after: string | null, size: number): Promise<HashPage> => {
    calls.push(after);
    const rows = ids
      .filter((id) => after === null || id > after)
      .slice(0, Math.min(size, serverCap))
      .map((id) => ({ scryfall_id: id, content_hash: id === "id-001" ? null : `h-${id}` }));
    return { rows, error: null };
  };
  return { fetchPage, calls };
}

test("loads every row across pages, keeping null hashes", async () => {
  const { fetchPage, calls } = fakeTable(7);
  const map = await loadExistingHashes(fetchPage, 3);
  assert.equal(map.size, 7);
  assert.equal(map.get("id-001"), null);
  assert.equal(map.get("id-006"), "h-id-006");
  // Keyset: each page starts after the last id of the one before.
  assert.deepEqual(calls, [null, "id-002", "id-005", "id-006"]);
});

test("a server that caps pages below the requested size does not truncate the read", async () => {
  // Ending on a short page would stop after the first 2 rows here.
  const { fetchPage } = fakeTable(7, 2);
  const map = await loadExistingHashes(fetchPage, 1000);
  assert.equal(map.size, 7);
});

test("an empty table yields an empty map", async () => {
  const { fetchPage } = fakeTable(0);
  assert.equal((await loadExistingHashes(fetchPage)).size, 0);
});

test("a read error fails the load rather than returning a partial map", async () => {
  // A partial map would make every unread row look new and get rewritten.
  let n = 0;
  const fetchPage = async (): Promise<HashPage> =>
    ++n === 1
      ? { rows: [{ scryfall_id: "id-000", content_hash: "x.y" }], error: null }
      : { rows: [], error: { code: "57014", message: "statement timeout" } };
  await assert.rejects(loadExistingHashes(fetchPage, 1), /statement timeout/);
});

// ---------------------------------------------------------------------------
// Price-only changes and the catalog
// ---------------------------------------------------------------------------

test("only price-only changes are counted as price-only", () => {
  const existing = new Map([[bolt.id, stored(row())]]);
  const priced = planWrites([row({ ...bolt, prices: { usd: "3.00" } }, DAY_2)], existing);
  assert.deepEqual([...priced.priceOnly], [bolt.id], "the catalog carries no prices, so this cannot make it stale");

  const both = planWrites(
    [row({ ...bolt, type_line: "Sorcery", prices: { usd: "3.00" } }, DAY_2)],
    existing,
  );
  assert.equal(both.priceOnly.size, 0);

  const meta = planWrites([row({ ...bolt, type_line: "Sorcery" }, DAY_2)], existing);
  assert.equal(meta.priceOnly.size, 0);

  const fresh = planWrites([row(bolt, DAY_2)], new Map([[bolt.id, null]]));
  assert.equal(fresh.priceOnly.size, 0, "an unfingerprinted row cannot be proven price-only");
});

// ---------------------------------------------------------------------------
// Guard against a short hash read
// ---------------------------------------------------------------------------

test("an empty read against a populated table is refused", () => {
  const message = checkHashReadComplete(0, 118_000);
  assert.ok(message);
  assert.match(message, /Read only 0 stored card fingerprints/);
  assert.match(message, /--force/);
});

test("a partial read is refused, a complete one is not", () => {
  assert.ok(checkHashReadComplete(50_000, 118_000));
  assert.equal(checkHashReadComplete(118_000, 118_000), null);
});

test("a row or two missing between the two reads is tolerated", () => {
  assert.equal(checkHashReadComplete(117_900, 118_000), null);
});

test("a first-ever run or a tiny database is never refused", () => {
  assert.equal(checkHashReadComplete(0, 0), null);
  assert.equal(checkHashReadComplete(0, 999), null);
});

// ---------------------------------------------------------------------------
// Did an earlier run die after writing?
// ---------------------------------------------------------------------------

test("no runs since the last success means the catalog is current", () => {
  assert.equal(catalogMayBeStale([]), false);
});

test("a failed run that had written rows leaves the catalog stale", () => {
  assert.equal(catalogMayBeStale([{ id: 7, status: "failed", cards_upserted: 4000 }]), true);
});

test("a failed run that wrote nothing does not", () => {
  assert.equal(catalogMayBeStale([{ id: 7, status: "failed", cards_upserted: 0 }]), false);
});

test("a run stuck at 'running' is treated as stale, since its count is unknown", () => {
  assert.equal(catalogMayBeStale([{ id: 7, status: "running", cards_upserted: 0 }]), true);
});

// ---------------------------------------------------------------------------
// Publishing the catalog
// ---------------------------------------------------------------------------

const quiet = { catalogChanged: 0, priorRunIncomplete: false, unpublishedEarlier: false, force: false };

test("a day with nothing catalog-visible changed does not publish", () => {
  assert.equal(shouldPublishCatalog(quiet), false);
});

test("each reason alone is enough to publish", () => {
  assert.equal(shouldPublishCatalog({ ...quiet, catalogChanged: 1 }), true);
  assert.equal(shouldPublishCatalog({ ...quiet, priorRunIncomplete: true }), true);
  assert.equal(shouldPublishCatalog({ ...quiet, force: true }), true);
});

test("an earlier publish that never landed is retried even when today changed nothing", () => {
  // The failure this exists for: sync succeeded, publish step died, next day
  // finds zero changed rows. Without the marker it would report false forever.
  assert.equal(shouldPublishCatalog({ ...quiet, unpublishedEarlier: true }), true);
});

// ---------------------------------------------------------------------------
// Ending the skipped-run republish loop
// ---------------------------------------------------------------------------

test("a failed run stops being stale once a publish has been stamped after it", () => {
  const failed = [{ id: 5, status: "failed", cards_upserted: 900 }];
  assert.equal(catalogMayBeStale(failed, 0), true);
  assert.equal(catalogMayBeStale(failed, 4), true, "a stamp older than the failure does not cover it");
  assert.equal(catalogMayBeStale(failed, 5), false);
  assert.equal(catalogMayBeStale(failed, 9), false);
});

test("failed-with-writes -> skipped -> publish stamps -> skipped republishes exactly once", () => {
  const failedRuns = [{ id: 1, status: "failed", cards_upserted: 500 }];
  let lastPublishedId = 0;
  const publishesOn = (day: string, runId: number): boolean => {
    const stale = catalogMayBeStale(failedRuns, lastPublishedId);
    const publish = shouldPublishCatalog({
      catalogChanged: 0,
      priorRunIncomplete: stale,
      unpublishedEarlier: false,
      force: false,
    });
    // The skipped run records `catalog_needs_publish = stale`, and a
    // successful publish stamps it.
    if (publish && stale) lastPublishedId = runId;
    assert.ok(day);
    return publish;
  };

  assert.equal(publishesOn("day 2, skipped", 2), true, "the failure's writes must be published once");
  assert.equal(publishesOn("day 3, skipped", 3), false, "and never again");
  assert.equal(publishesOn("day 4, skipped", 4), false);
});

test("if that publish never lands, the next skipped day tries again", () => {
  const failedRuns = [{ id: 1, status: "failed", cards_upserted: 500 }];
  // No stamp was recorded, so lastPublishedRunId is still 0.
  assert.equal(catalogMayBeStale(failedRuns, 0), true);
});
