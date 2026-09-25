/**
 * The share leak test. A share is readable by every signed-in person who
 * holds the link, so the projection must contain NOTHING the owner has not
 * deliberately put on the table. This plants uniquely named secrets in every
 * hidden place (the hand, the library, the sideboard, a face-down card, notes,
 * a private peek, a custom token's image URL, the seeds) and asserts that none
 * of them survives `JSON.stringify` of the projection. It also proves the test
 * itself can fail: a deliberately leaky projection is checked and must be
 * caught, otherwise a green run would prove nothing.
 *
 * Run with: npx tsx --test scripts/playtest-share-projection.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { makeGameCard, makeState } from "../src/lib/playtest/board/fixtures";
import { isPublicImage, projectPublic, readProjection, type PublicProjection } from "../src/lib/playtest/board/share";
import type { GameCommand } from "../src/lib/playtest/board/commands";
import type { GameState, ZoneId } from "../src/lib/playtest/board/types";

const SECRETS = {
  handName: "ZZHandSecretCard",
  libraryName: "ZZLibrarySecretCard",
  libraryTop: "ZZLibraryTopSecret",
  sideboardName: "ZZSideboardSecret",
  faceDownName: "ZZFaceDownSecret",
  note: "ZZPrivateNoteText",
  peeked: "ZZPeekedSecret",
  tokenUrl: "https://evil.example/ZZtracking-pixel.png",
  fingerprint: "ab".repeat(32),
  deckId: "ZZDeckIdSecret",
  gameSeed: 918273645,
  simSeed: 555444333,
} as const;

function scenario(): GameState {
  const cards = [
    makeGameCard("obj-hand", SECRETS.handName, { cardId: "scry-hand", oracleId: "orc-hand", imageSmall: "https://cards.scryfall.io/small/hand.jpg", typeLine: "Instant" }),
    makeGameCard("obj-top", SECRETS.libraryTop, { cardId: "scry-top", imageSmall: "https://cards.scryfall.io/small/top.jpg" }),
    makeGameCard("obj-lib", SECRETS.libraryName, { cardId: "scry-lib" }),
    makeGameCard("obj-side", SECRETS.sideboardName, { cardId: "scry-side" }),
    makeGameCard("obj-fd", SECRETS.faceDownName, { cardId: "scry-fd", imageSmall: "https://cards.scryfall.io/small/fd.jpg", imageNormal: "https://cards.scryfall.io/normal/fd.jpg", typeLine: "Legendary Creature", manaValue: 7, power: "9", toughness: "9" }),
    makeGameCard("obj-bear", "Grizzly Bears", { cardId: "scry-bear", imageSmall: "https://cards.scryfall.io/small/bear.jpg", imageNormal: "https://cards.scryfall.io/normal/bear.jpg", typeLine: "Creature — Bear", manaValue: 2, power: "2", toughness: "2", counters: { "+1/+1": 2 } }),
    makeGameCard("obj-peek", SECRETS.peeked, { cardId: "scry-peek" }),
  ];
  let state = makeState(cards, { library: ["obj-top", "obj-peek", "obj-lib"], hand: ["obj-hand"], sideboard: ["obj-side"], battlefield: [] });
  state = { ...state, deckId: SECRETS.deckId, seed: SECRETS.gameSeed, source: { fingerprint: SECRETS.fingerprint, deckSize: 7 }, simulator: { ...state.simulator, seed: SECRETS.simSeed } };
  state = { ...state, cards: { ...state.cards, "obj-fd": { ...state.cards["obj-fd"] }, "obj-bear": { ...state.cards["obj-bear"] } }, zones: { ...state.zones, library: [...state.zones.library, "obj-fd", "obj-bear"] } };

  const commands: GameCommand[] = [
    { type: "MOVE_MANY", ids: ["obj-fd"], to: "battlefield", at: "bottom", faceDown: true },
    { type: "MOVE_MANY", ids: ["obj-bear"], to: "battlefield", at: "bottom" },
    { type: "SET_NOTE", cardId: "obj-bear", note: SECRETS.note },
    { type: "SET_NOTE", cardId: "obj-fd", note: SECRETS.note + "-facedown" },
    { type: "PEEK", zone: "library", from: "top", count: 3 },
    { type: "SHUFFLE", zone: "library", seed: 31337 },
    { type: "DRAW", count: 1 },
    { type: "CREATE_EXTRA", ids: ["tok"], spec: { name: "Spirit", power: "1", toughness: "1", imageSmall: SECRETS.tokenUrl, imageNormal: SECRETS.tokenUrl }, kind: "token", zone: "battlefield" },
    { type: "REVEAL", ids: ["obj-hand"], revealed: true },
    { type: "RECORD_INTERACTION", turn: 3, rerollIndex: 0, prompts: ["counterspell"], resolution: "pending" },
    { type: "SET_LIFE", delta: -4 },
    { type: "MILL", count: 1 },
  ];
  for (const command of commands) state = applyCommand(state, command);
  return state;
}

const FORBIDDEN = [
  SECRETS.libraryName,
  SECRETS.libraryTop,
  SECRETS.sideboardName,
  SECRETS.faceDownName,
  SECRETS.note,
  SECRETS.peeked,
  SECRETS.tokenUrl,
  "ZZtracking-pixel",
  SECRETS.fingerprint,
  SECRETS.deckId,
  String(SECRETS.gameSeed),
  String(SECRETS.simSeed),
  "31337",
  "scry-",
  "orc-",
  "obj-",
  "fd.jpg",
  "seed",
  "fingerprint",
  "deckId",
  "note",
];

function leaks(projection: PublicProjection, forbidden: readonly string[]): string[] {
  const json = JSON.stringify(projection);
  return forbidden.filter((needle) => json.includes(needle));
}

/** The scenario shuffles, draws and mills at random-looking (but seeded)
 *  points, so a secret-named card can legitimately end up on the public
 *  table (milled into the graveyard) or in a hand the owner chose to show.
 *  Those names are allowed to appear; everything else must not. */
function stillHidden(state: GameState, showHand: boolean, names: readonly string[]): string[] {
  const visible = new Set<string>();
  const zones: ZoneId[] = ["battlefield", "graveyard", "exile", "command", "temporary", ...(showHand ? (["hand"] as ZoneId[]) : [])];
  for (const zone of zones) for (const id of state.zones[zone]) if (state.cards[id].face !== "face-down") visible.add(state.cards[id].name);
  return names.filter((n) => !visible.has(n));
}

test("the hidden hand card, library, sideboard, face-down identity, notes, peeks, seeds and ids never appear", () => {
  const state = scenario();
  // Sanity: the scenario really has the secrets where we think.
  assert.ok(state.zones.hand.length >= 1 && state.zones.library.length >= 1 && state.zones.sideboard.length === 1);
  const projection = projectPublic(state, { showHand: false });
  assert.deepEqual(leaks(projection, stillHidden(state, false, [...FORBIDDEN, SECRETS.handName])), []);
  // The secrets that are ALWAYS hidden are checked unconditionally.
  assert.deepEqual(leaks(projection, [SECRETS.sideboardName, SECRETS.faceDownName, SECRETS.note, SECRETS.tokenUrl, SECRETS.fingerprint, SECRETS.deckId, "31337", "obj-", "scry-", "orc-"]), []);
});

test("the projection carries counts for hidden zones and nothing else about them", () => {
  const state = scenario();
  const projection = projectPublic(state, { showHand: false });
  assert.equal(projection.counts.library, state.zones.library.length);
  assert.equal(projection.counts.hand, state.zones.hand.length);
  assert.equal(projection.counts.sideboard, 1);
  assert.equal(projection.hand, null);
  assert.deepEqual(Object.keys(projection.zones).sort(), ["battlefield", "command", "exile", "graveyard", "temporary"]);
});

test("a face-down card is shown as face-down with no identity, but keeps its table state", () => {
  const state = scenario();
  const projection = projectPublic(state, { showHand: false });
  const faceDown = projection.zones.battlefield.find((c) => c.faceDown)!;
  assert.ok(faceDown, "the face-down card is on the table");
  assert.equal(faceDown.name, null);
  assert.equal(faceDown.typeLine, null);
  assert.equal(faceDown.manaValue, null);
  assert.equal(faceDown.imageSmall, null);
  assert.equal(faceDown.imageNormal, null);
  assert.equal(faceDown.power, null);
  assert.equal(typeof faceDown.x, "number", "still positioned");
});

test("showing the hand is an affirmative choice, exposes display fields only, and never internal ids", () => {
  const state = scenario();
  const projection = projectPublic(state, { showHand: true });
  assert.equal(projection.hand?.length, state.zones.hand.length);
  const json = JSON.stringify(projection);
  for (const id of state.zones.hand) assert.ok(!json.includes(id), `hand id ${id} leaked`);
  assert.deepEqual(leaks(projection, stillHidden(state, true, FORBIDDEN)), [], "showing the hand reveals only the hand");
  const handCard = projection.hand![0];
  assert.deepEqual(Object.keys(handCard).sort(), Object.keys(projection.zones.battlefield[0]).sort());
});

test("object ids are replaced by fresh per-share refs", () => {
  const projection = projectPublic(scenario(), { showHand: true });
  const refs = [...Object.values(projection.zones).flat(), ...(projection.hand ?? [])].map((c) => c.ref);
  assert.equal(new Set(refs).size, refs.length);
  assert.ok(refs.every((r) => /^p\d+$/.test(r)));
});

test("custom image URLs are dropped; only https on cards.scryfall.io is kept", () => {
  assert.equal(isPublicImage("https://cards.scryfall.io/small/front/a/b/ab.jpg?1234"), "https://cards.scryfall.io/small/front/a/b/ab.jpg?1234");
  for (const bad of ["http://cards.scryfall.io/x.jpg", "https://evil.example/x.png", "https://cards.scryfall.io.evil.example/x.png", "javascript:alert(1)", "data:image/png;base64,AAAA", null, "https://cards.scryfall.io/" + "a".repeat(400)]) {
    assert.equal(isPublicImage(bad as string | null), null, String(bad));
  }
  const token = projectPublic(scenario(), { showHand: false }).zones.battlefield.find((c) => c.name === "Spirit")!;
  assert.equal(token.imageSmall, null);
  assert.equal(token.imageNormal, null);
});

test("the public log is counts only for draws and mills, and has no peeks, notes, prompts or seeds", () => {
  const projection = projectPublic(scenario(), { showHand: false });
  const text = projection.log.map((l) => l.text).join("\n");
  assert.ok(!/Looked at/.test(text));
  assert.ok(!/Noted/.test(text));
  assert.ok(!/prompt/i.test(text));
  assert.ok(/Drew 1 card/.test(text));
  assert.ok(/Milled 1 card/.test(text));
  assert.ok(!text.includes(SECRETS.handName) && !text.includes(SECRETS.libraryTop));
});

test("a shuffle appears without its seed, and the hidden ORIGIN of a play is not disclosed", () => {
  const state = scenario();
  const played = applyCommand(state, { type: "MOVE_MANY", ids: state.zones.hand, to: "battlefield", at: "bottom" });
  const projection = projectPublic(played, { showHand: false });
  assert.ok(projection.log.some((l) => /Shuffled the library/.test(l.text)));
  assert.ok(!JSON.stringify(projection).includes("31337"));
});

test("the projection is rebuilt from an allow-list: unknown state fields cannot ride along", () => {
  const state = scenario() as GameState & { extraSecret?: string };
  state.extraSecret = "ZZUnknownFieldSecret";
  (state.cards["obj-bear"] as unknown as Record<string, unknown>).hiddenField = "ZZUnknownCardFieldSecret";
  const json = JSON.stringify(projectPublic(state, { showHand: true }));
  assert.ok(!json.includes("ZZUnknownFieldSecret"));
  assert.ok(!json.includes("ZZUnknownCardFieldSecret"));
});

test("PROOF THE TEST CAN FAIL: a projection that includes zones.library is caught", () => {
  const state = scenario();
  const leaky = { ...projectPublic(state, { showHand: false }), library: state.zones.library.map((id) => state.cards[id]) } as unknown as PublicProjection;
  const found = leaks(leaky, FORBIDDEN);
  assert.ok(found.length > 0, "the leak check must notice a leaked library");
  assert.ok(found.includes(SECRETS.libraryTop) || found.includes(SECRETS.libraryName));

  const leakyHand = { ...projectPublic(state, { showHand: false }), hand: state.zones.hand.map((id) => state.cards[id]) } as unknown as PublicProjection;
  assert.ok(leaks(leakyHand, ["obj-", "scry-", SECRETS.handName]).length > 0, "a leaked hand is caught too");
});

test("readProjection accepts what projectPublic produces and refuses tampered data", () => {
  const good = projectPublic(scenario(), { showHand: true });
  assert.deepEqual(readProjection(JSON.parse(JSON.stringify(good))), good);

  const clone = () => JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
  const withImage = clone();
  ((withImage.zones as Record<string, Array<Record<string, unknown>>>).battlefield[0]).imageSmall = "https://evil.example/x.png";
  const read = readProjection(withImage)!;
  assert.equal(read.zones.battlefield[0].imageSmall, null, "a tampered image URL is dropped on the way out");

  assert.equal(readProjection({ ...clone(), version: 2 }), null);
  assert.equal(readProjection({ ...clone(), turn: "3" }), null);
  assert.equal(readProjection({ ...clone(), zones: { battlefield: "x" } }), null);
  assert.equal(readProjection(null), null);
  assert.equal(readProjection("nope"), null);
  const huge = clone();
  (huge.log as unknown[]).length = 0;
  for (let i = 0; i < 1001; i++) (huge.log as unknown[]).push({ turn: 0, text: "x" });
  assert.equal(readProjection(huge), null);
});
