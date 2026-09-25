/**
 * Crash-recovery helpers (src/lib/playtest/recovery.ts), settings and dice.
 * The localStorage reads/writes are in the UI hook; everything decidable
 * without a browser is here, including the rules that keep one person's game
 * from being offered to another.
 *
 * Run with: npx tsx --test scripts/playtest-recovery.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DECKS,
  agoText,
  allPlaytestKeys,
  buildEnvelope,
  dropFromIndex,
  foreignKeys,
  gameKey,
  indexKey,
  nextWriteDelay,
  parseEnvelope,
  parseIndex,
  prefsKey,
  touchIndex,
} from "../src/lib/playtest/recovery";
import { DEFAULT_SETTINGS, animationsEnabled, sanitizeSettings } from "../src/lib/playtest/settings";
import { DICE_KINDS, diceLabel, rollResult } from "../src/lib/playtest/dice";
import { mulberry32 } from "../src/lib/playtest/rng";
import { applyCommand } from "../src/lib/playtest/board/reduce";
import { fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";

const state = applyCommand(fixtureSixtyCardStart(), { type: "SET_TRACKER", path: "life", value: 11 });
const DECK = state.deckId;

test("an envelope round-trips a valid game with its fingerprint and the linked session", () => {
  const raw = buildEnvelope(state, 1_700_000_000_000, { sessionId: "s1", sessionUpdatedAt: "2026-09-25T10:00:00Z" });
  const parsed = parseEnvelope(raw, DECK);
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;
  assert.deepEqual(parsed.state, state);
  assert.equal(parsed.savedAt, 1_700_000_000_000);
  assert.equal(parsed.fingerprint, state.source.fingerprint);
  assert.equal(parsed.sessionId, "s1");
});

test("a stored game that fails validation, is another deck's, or is garbage is never offered", () => {
  const raw = buildEnvelope(state, 1, { sessionId: null, sessionUpdatedAt: null });
  assert.equal(parseEnvelope(raw, "some-other-deck").status, "wrong-deck");
  assert.equal(parseEnvelope("{nope", DECK).status, "invalid");
  assert.equal(parseEnvelope("[]", DECK).status, "invalid");
  assert.equal(parseEnvelope(JSON.stringify({ version: 99, savedAt: 1, snapshot: state }), DECK).status, "invalid");
  const broken = JSON.parse(raw) as { snapshot: { zones: { hand: string[] } } };
  broken.snapshot.zones.hand = ["ghost"];
  assert.equal(parseEnvelope(JSON.stringify(broken), DECK).status, "invalid");
  const noTime = JSON.parse(raw) as Record<string, unknown>;
  noTime.savedAt = "yesterday";
  assert.equal(parseEnvelope(JSON.stringify(noTime), DECK).status, "invalid");
});

test("keys are namespaced by user and deck", () => {
  assert.equal(gameKey("u1", "d1"), "upkeep:playtest:v2:u1:d1");
  assert.equal(indexKey("u1"), "upkeep:playtest:index:u1");
  assert.equal(prefsKey("u1"), "upkeep:playtest:prefs:v1:u1");
});

test("the index keeps at most five decks and evicts the least recently saved", () => {
  let index = parseIndex(null);
  const evictedAll: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const result = touchIndex(index, `deck-${i}`, i * 1000);
    index = result.index;
    evictedAll.push(...result.evicted);
  }
  assert.equal(index.decks.length, MAX_DECKS);
  assert.deepEqual(index.decks.map((d) => d.deckId), ["deck-8", "deck-7", "deck-6", "deck-5", "deck-4"]);
  assert.deepEqual(evictedAll, ["deck-1", "deck-2", "deck-3"]);
  const refreshed = touchIndex(index, "deck-4", 99_000);
  assert.equal(refreshed.index.decks[0].deckId, "deck-4", "saving again moves a deck to the front");
  assert.equal(refreshed.evicted.length, 0);
  assert.equal(dropFromIndex(index, "deck-8").decks.length, 4);
});

test("a corrupt index is treated as empty rather than throwing", () => {
  assert.deepEqual(parseIndex("{oops"), { decks: [] });
  assert.deepEqual(parseIndex('{"decks":"nope"}'), { decks: [] });
  assert.deepEqual(parseIndex('{"decks":[{"deckId":1},{"deckId":"a","savedAt":5}]}').decks, [{ deckId: "a", savedAt: 5 }]);
});

test("another user's keys are found for deletion; this user's own are kept", () => {
  const keys = [
    gameKey("me", "d1"),
    gameKey("me", "d2"),
    indexKey("me"),
    prefsKey("me"),
    gameKey("them", "d1"),
    indexKey("them"),
    prefsKey("them"),
    "upkeep:playtest:v1:legacy",
    "unrelated-key",
    "upkeep:other",
  ];
  const foreign = foreignKeys(keys, "me");
  assert.deepEqual(foreign.sort(), [gameKey("them", "d1"), indexKey("them"), prefsKey("them"), "upkeep:playtest:v1:legacy"].sort());
  assert.deepEqual(allPlaytestKeys(keys).length, 8, "sign-out clears every playtest key");
  assert.ok(!allPlaytestKeys(keys).includes("unrelated-key"));
  // A user id that is a prefix of another's must not shield it.
  assert.deepEqual(foreignKeys([gameKey("me2", "d1")], "me"), [gameKey("me2", "d1")]);
});

test("the restore prompt says how long ago in plain words", () => {
  const now = 10_000_000;
  assert.equal(agoText(now - 20_000, now), "less than a minute ago");
  assert.equal(agoText(now - 60_000, now), "1 minute ago");
  assert.equal(agoText(now - 12 * 60_000, now), "12 minutes ago");
  assert.equal(agoText(now - 3 * 3_600_000, now), "3 hours ago");
  assert.equal(agoText(now - 3 * 86_400_000, now), "3 days ago");
});

test("write throttle: 1s after the last change, never more than 5s while changes keep coming", () => {
  assert.equal(nextWriteDelay(1000, null), 1000, "first change: wait for quiet");
  assert.equal(nextWriteDelay(3000, 1000), 1000, "2s in: still waiting for quiet");
  assert.equal(nextWriteDelay(5500, 1000), 500, "4.5s in: only 0.5s to the ceiling");
  assert.equal(nextWriteDelay(6000, 1000), 0, "5s in: write now");
  assert.equal(nextWriteDelay(20_000, 1000), 0);
});

test("settings: any input yields a complete valid object; the OS reduced-motion preference always wins", () => {
  assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings("junk"), DEFAULT_SETTINGS);
  const mixed = sanitizeSettings({ cardSize: "huge", handSize: "large", maxVisibleHand: 9999, playmat: "nope", sleeve: "plum", motion: "full", showLabels: "yes" });
  assert.equal(mixed.cardSize, DEFAULT_SETTINGS.cardSize);
  assert.equal(mixed.handSize, "large");
  assert.equal(mixed.maxVisibleHand, 40);
  assert.equal(mixed.playmat, DEFAULT_SETTINGS.playmat);
  assert.equal(mixed.sleeve, "plum");
  assert.equal(mixed.motion, "system", "there is no 'force animations on'");
  assert.equal(mixed.showLabels, DEFAULT_SETTINGS.showLabels, "a wrong-typed value falls back to the default");
  assert.equal(sanitizeSettings({ maxVisibleHand: 1 }).maxVisibleHand, 4);
  assert.equal(animationsEnabled("system", false), true);
  assert.equal(animationsEnabled("system", true), false);
  assert.equal(animationsEnabled("reduce", false), false);
});

test("dice: every result is in range, coins are 0/1, and a seeded roll is repeatable", () => {
  const rng = mulberry32(1);
  for (const kind of DICE_KINDS) {
    const sides = kind === "coin" ? 2 : Number(kind.slice(1));
    for (let i = 0; i < 300; i++) {
      const result = rollResult(kind, rng);
      if (kind === "coin") assert.ok(result === 0 || result === 1);
      else assert.ok(result >= 1 && result <= sides, `${kind} ${result}`);
    }
  }
  assert.equal(rollResult("d20", mulberry32(5)), rollResult("d20", mulberry32(5)));
  assert.equal(diceLabel("coin", 1), "Heads");
  assert.equal(diceLabel("d6", 4), "d6: 4");
  const seen = new Set(Array.from({ length: 200 }, () => rollResult("d6", rng)));
  assert.equal(seen.size, 6, "every face comes up");
});
