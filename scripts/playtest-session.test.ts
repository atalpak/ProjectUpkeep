/**
 * Pure save/share helpers (src/lib/playtest/session.ts), the slim client
 * payload (slim.ts) and the plain-wording error map (supabase/errors.ts).
 * These are the rules the server actions lean on, kept testable without a
 * database or a Next runtime.
 *
 * Run with: npx tsx --test scripts/playtest-session.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_SNAPSHOT_CHARS,
  MAX_TITLE,
  buildPreview,
  cleanTitle,
  copyTitle,
  prepareSave,
  previewLine,
  readPreview,
} from "../src/lib/playtest/session";
import { slimEntry } from "../src/lib/playtest/slim";
import { playtestErrorMessage } from "../src/lib/supabase/errors";
import { applyCommand } from "../src/lib/playtest/board/reduce";
import { fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";
import { validateSnapshot } from "../src/lib/playtest/board/serialize";
import type { DeckListEntry } from "../src/lib/collection/queries";
import type { Card } from "../src/lib/types";

test("titles are trimmed, whitespace-collapsed and capped; nothing left means no title", () => {
  assert.equal(cleanTitle("  Turn   four \n line "), "Turn four line");
  assert.equal(cleanTitle("x".repeat(300))?.length, MAX_TITLE);
  assert.equal(cleanTitle("   \n\t "), null);
  assert.equal(cleanTitle(""), null);
  assert.equal(cleanTitle(42), null);
  assert.equal(cleanTitle(null), null);
  const long = cleanTitle("a ".repeat(200))!;
  assert.ok(long.length <= MAX_TITLE && !long.endsWith(" "));
});

test("a copy's title keeps its suffix even when the base title is at the cap", () => {
  assert.equal(copyTitle("My game"), "My game (copy)");
  const cut = copyTitle("z".repeat(100));
  assert.equal(cut.length, 100);
  assert.ok(cut.endsWith(" (copy)"));
  assert.ok(copyTitle("q".repeat(93) + "   ").endsWith("(copy)"));
});

test("the preview is computed from the state, and reads back defensively from jsonb", () => {
  let state = fixtureSixtyCardStart();
  state = applyCommand(state, { type: "DRAW", count: 7 });
  state = applyCommand(state, { type: "SET_TRACKER", path: "life", value: 31 });
  state = applyCommand(state, { type: "NEXT_TURN" });
  const preview = buildPreview(state);
  assert.deepEqual(preview, { turn: 1, life: 31, format: "constructed", hand: 7, library: 53, battlefield: 0, graveyard: 0, exile: 0, command: 0 });
  assert.match(previewLine(preview), /Turn 1 · 31 life · 7 in hand/);
  assert.match(previewLine({ ...preview, turn: 0 }), /Opening hand/);
  assert.deepEqual(readPreview(preview), preview);
  assert.equal(readPreview(null).turn, 0);
  assert.equal(readPreview({ turn: "x", life: Number.NaN, format: 9 }).format, "constructed");
  assert.equal(readPreview({ hand: 3.9 }).hand, 3);
});

test("prepareSave returns canonical JSON that validates back to the same state, plus the preview", () => {
  const state = applyCommand(fixtureSixtyCardStart(), { type: "DRAW", count: 3 });
  const prepared = prepareSave(state);
  assert.ok(!("error" in prepared));
  if ("error" in prepared) return;
  assert.deepEqual(validateSnapshot(JSON.parse(prepared.canonical)), state);
  assert.equal(prepared.preview.hand, 3);
  assert.ok(prepared.canonical.length < MAX_SNAPSHOT_CHARS);
});

test("prepareSave trims the log to fit and records it; it never trims the board", () => {
  let state = fixtureSixtyCardStart();
  // A note per card fills the board section without touching the log.
  for (let i = 0; i < 1000; i++) state = applyCommand(state, { type: "SET_TRACKER", path: "life", value: 5 + (i % 2) });
  const before = JSON.stringify(state).length;
  assert.ok(before < MAX_SNAPSHOT_CHARS);
  const fat = { ...state, events: state.events.map((e) => ({ ...e, names: Array.from({ length: 200 }, () => "n".repeat(190)) })) };
  assert.ok(JSON.stringify(fat).length > MAX_SNAPSHOT_CHARS);
  const prepared = prepareSave(fat);
  assert.ok(!("error" in prepared), "a fat log is trimmed, not refused");
  if ("error" in prepared) return;
  assert.ok(prepared.canonical.length <= MAX_SNAPSHOT_CHARS);
  assert.ok(prepared.state.eventsTruncatedBefore !== null);
  assert.deepEqual(prepared.state.cards, state.cards);
  assert.deepEqual(prepared.state.zones, state.zones);
});

test("a board too large to save even without its log is refused in plain words", () => {
  const state = fixtureSixtyCardStart();
  const notes: Record<string, (typeof state.cards)[string]> = {};
  for (const [id, card] of Object.entries(state.cards)) notes[id] = { ...card, note: "n".repeat(1000), name: "N".repeat(200) };
  const huge = { ...state, cards: notes };
  const bigger = { ...huge, source: { ...huge.source } };
  // 60 cards x 1.2KB is far under the cap; inflate with image URLs to cross it.
  const cards = { ...bigger.cards };
  for (const id of Object.keys(cards)) cards[id] = { ...cards[id], imageSmall: "https://cards.scryfall.io/" + "a".repeat(470), imageNormal: "https://cards.scryfall.io/" + "b".repeat(470), imageBack: "https://cards.scryfall.io/" + "c".repeat(470) };
  const tooBig = { ...bigger, cards, config: { ...bigger.config, commanderIds: [] } };
  const filler = Object.fromEntries(Array.from({ length: 1400 }, (_, i) => [`x${i}`, { ...cards[Object.keys(cards)[0]], id: `x${i}` }]));
  const enormous = { ...tooBig, cards: { ...tooBig.cards, ...filler }, zones: { ...tooBig.zones, exile: Array.from({ length: 1400 }, (_, i) => `x${i}`) } };
  const result = prepareSave(enormous);
  assert.ok("error" in result);
  if ("error" in result) assert.match(result.error, /too large to save/);
});

function card(over: Partial<Card>): Card {
  return {
    scryfall_id: "s1",
    oracle_id: "o1",
    name: "Delver of Secrets",
    type_line: "Creature",
    cmc: 1,
    mana_cost: "{U}",
    produced_mana: null,
    oracle_text: "text",
    image_uri: "https://cards.scryfall.io/normal/a.jpg",
    image_uri_small: "https://cards.scryfall.io/small/a.jpg",
    power: "1",
    toughness: "1",
    loyalty: null,
    price_usd: 12.5,
    price_eur: 11,
    purchase_uri: "https://buy",
    flavor_text: "fluff",
    artist: "someone",
    card_faces: null,
    ...over,
  } as unknown as Card;
}

test("slimEntry keeps what the table draws and drops prices, artist and the rest", () => {
  const entry = { id: "e1", deck_id: "d", card_id: "s1", quantity: 2, cards: card({}), sleeved: 4, sleevedFinishes: ["foil"] } as unknown as DeckListEntry;
  const slim = slimEntry(entry);
  assert.equal(slim.quantity, 2);
  assert.equal(slim.cards?.name, "Delver of Secrets");
  const json = JSON.stringify(slim);
  for (const dropped of ["price_usd", "purchase_uri", "artist", "flavor_text", "sleeved"]) assert.ok(!json.includes(dropped), dropped);
});

test("slimEntry trims a double-faced card's faces to what the inspector needs and nulls single-faced ones", () => {
  const faces = [
    { name: "Front", oracle_text: "a", image_uris: { small: "s", normal: "https://cards.scryfall.io/n/f.jpg", large: "l" }, artist: "x", flavor_text: "y" },
    { name: "Back", oracle_text: "b", image_uris: { small: "s", normal: "https://cards.scryfall.io/n/b.jpg", large: "l" }, artist: "x" },
  ];
  const dfc = slimEntry({ id: "e", deck_id: "d", card_id: "s", quantity: 1, cards: card({ card_faces: faces as never }), sleeved: 0, sleevedFinishes: [] } as unknown as DeckListEntry);
  assert.equal(dfc.cards?.card_faces?.length, 2);
  assert.deepEqual(dfc.cards?.card_faces?.[1].image_uris, { normal: "https://cards.scryfall.io/n/b.jpg" });
  assert.ok(!JSON.stringify(dfc).includes("artist"));
  const single = slimEntry({ id: "e", deck_id: "d", card_id: "s", quantity: 1, cards: card({ card_faces: [faces[0]] as never }), sleeved: 0, sleevedFinishes: [] } as unknown as DeckListEntry);
  assert.equal(single.cards?.card_faces, null);
  assert.equal(slimEntry({ id: "e", deck_id: "d", card_id: "s", quantity: 1, cards: null, sleeved: 0, sleevedFinishes: [] } as unknown as DeckListEntry).cards, null);
});

test("database errors from saves and shares map to plain wording, by prefix or SQLSTATE", () => {
  assert.match(playtestErrorMessage({ message: "playtest_sessions_quota_deck: a deck can hold at most 10 saved games", code: "23514" }), /10 saved games/);
  assert.match(playtestErrorMessage({ message: "playtest_sessions_quota_user: ...", code: "23514" }), /30 saved games/);
  assert.match(playtestErrorMessage({ message: "playtest_shares_quota: ...", code: "23514" }), /10 active shared tables/);
  assert.match(playtestErrorMessage({ code: "42P01", message: 'relation "playtest_sessions" does not exist' }), /not been applied/);
  assert.match(playtestErrorMessage({ code: "PGRST205" }), /not been applied/);
  assert.match(playtestErrorMessage({ code: "42501" }), /permission/);
  assert.match(playtestErrorMessage({ code: "23503" }), /no longer exists/);
  assert.match(playtestErrorMessage({ code: "23514", message: "new row violates check constraint" }), /too large|not valid/);
  assert.match(playtestErrorMessage({}), /Try again/);
  for (const raw of [{ code: "42501", message: "permission denied for table playtest_sessions" }, { code: "23514", message: "violates check constraint playtest_sessions_snapshot_size" }]) {
    assert.ok(!/playtest_sessions|constraint|relation/i.test(playtestErrorMessage(raw)), "no schema jargon reaches the user");
  }
});
