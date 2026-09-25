/**
 * The zone overlay's rules: what it lists, when closing shuffles, and that a
 * shuffle-on-close is resolved exactly once even when the overlay stays open
 * across drags and can be closed from several places.
 *
 * Run with: npx tsx --test scripts/playtest-zone-overlay.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createExternalStore, createPlayStore } from "../src/components/playtester/store";
import { createUiStore } from "../src/components/playtester/ui-store";
import {
  closeZoneOverlay,
  filterOverlayIds,
  openDialog,
  overlayDragEnabled,
  overlayZoneIds,
  shouldShuffleOnClose,
} from "../src/components/playtester/zone-overlay";
import { dropCommand } from "../src/components/playtester/drag";
import { fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";
import { checkInvariants } from "../src/lib/playtest/board/invariants";
import { DEFAULT_SETTINGS, type Settings } from "../src/lib/playtest/settings";

function setup(patch: Partial<Settings> = {}) {
  const store = createPlayStore();
  store.replace(fixtureSixtyCardStart());
  const ui = createUiStore();
  const settings = createExternalStore<Settings>({ ...DEFAULT_SETTINGS, ...patch });
  let seeds = 0;
  const seed = () => 1000 + seeds++;
  const openSearch = () => ui.set((s) => ({ ...s, dialog: "zone", zone: { zone: "library", mode: "search" } }));
  const shuffleEvents = () => store.get().game!.events.filter((e) => e.kind === "shuffle").length;
  return { store, ui, settings, seed, openSearch, shuffleEvents, seedsUsed: () => seeds };
}

test("only a library search shuffles on close, and only when the setting is on", () => {
  assert.equal(shouldShuffleOnClose({ zone: "library", mode: "search" }, true), true);
  assert.equal(shouldShuffleOnClose({ zone: "library", mode: "search" }, false), false);
  assert.equal(shouldShuffleOnClose({ zone: "library", mode: "peek", count: 3 }, true), false);
  assert.equal(shouldShuffleOnClose({ zone: "library", mode: "browse" }, true), false);
  assert.equal(shouldShuffleOnClose({ zone: "graveyard", mode: "search" }, true), false);
  assert.equal(shouldShuffleOnClose(null, true), false);
});

test("closing a library search shuffles once; a second close from another path does nothing", () => {
  const t = setup();
  t.openSearch();
  const before = [...t.store.get().game!.zones.library];
  assert.equal(closeZoneOverlay(t.store, t.ui, t.settings, t.seed), true);
  assert.equal(closeZoneOverlay(t.store, t.ui, t.settings, t.seed), false, "Escape after Done must not shuffle again");
  assert.equal(closeZoneOverlay(t.store, t.ui, t.settings, t.seed), false);
  assert.equal(t.shuffleEvents(), 1);
  assert.equal(t.seedsUsed(), 1, "one seed drawn, so one shuffle decided");
  assert.equal(t.store.get().history.past.length, 1, "the shuffle is one undo step");
  assert.notDeepEqual(t.store.get().game!.zones.library, before);
  assert.equal(t.ui.get().dialog, null);
  assert.equal(t.ui.get().zone, null);
});

test("shuffle on close off: closing changes nothing in the library and records no history", () => {
  const t = setup({ shuffleOnClose: false });
  t.openSearch();
  const before = t.store.get().game;
  assert.equal(closeZoneOverlay(t.store, t.ui, t.settings, t.seed), true);
  assert.equal(t.store.get().game, before);
  assert.equal(t.store.get().history.past.length, 0);
  assert.equal(t.shuffleEvents(), 0);
});

test("closing with no overlay open is a no-op", () => {
  const t = setup();
  assert.equal(closeZoneOverlay(t.store, t.ui, t.settings, t.seed), false);
  assert.equal(t.shuffleEvents(), 0);
});

test("dragging cards out while the search stays open moves them, and the one shuffle on close does not undo it", () => {
  const t = setup({ keepSearchOpenWhileDragging: true });
  t.openSearch();
  const game0 = t.store.get().game!;
  const [first, second, third] = game0.zones.library;

  // The overlay lists the library; a drop is exactly what startHandDrag sends.
  t.store.dispatch(dropCommand([first], "hand"));
  t.store.dispatch({ type: "MOVE_MANY", ids: [second], to: "battlefield", at: "bottom", pos: { x: 0.4, y: 0.4 }, tapped: false });
  t.store.dispatch(dropCommand([third], "graveyard"));

  // Still open: no shuffle has happened for any of the three drags.
  assert.equal(t.ui.get().dialog, "zone");
  assert.equal(t.shuffleEvents(), 0);
  const mid = t.store.get().game!;
  assert.equal(mid.zones.library.length, 57);
  assert.deepEqual(mid.zones.hand, [first]);
  assert.deepEqual(mid.zones.battlefield, [second]);
  assert.deepEqual(mid.zones.graveyard, [third]);
  // The list the overlay draws no longer shows the dragged-out cards.
  const listed = overlayZoneIds(mid, { zone: "library", mode: "search" }, "library");
  for (const id of [first, second, third]) assert.ok(!listed.includes(id));

  closeZoneOverlay(t.store, t.ui, t.settings, t.seed);
  closeZoneOverlay(t.store, t.ui, t.settings, t.seed);
  const end = t.store.get().game!;
  assert.equal(t.shuffleEvents(), 1);
  assert.equal(end.zones.library.length, 57);
  assert.deepEqual(end.zones.hand, [first]);
  assert.deepEqual(end.zones.battlefield, [second]);
  assert.deepEqual(end.zones.graveyard, [third]);
  assert.deepEqual([...end.zones.library].sort(), [...mid.zones.library].sort(), "same cards, new order");
  assert.deepEqual(checkInvariants(end), []);
  // Three drags and one shuffle: four undo steps, one per gesture.
  assert.equal(t.store.get().history.past.length, 4);
});

test("dropping a card back on the library from the overlay is one step and keeps every card", () => {
  const t = setup({ keepSearchOpenWhileDragging: true });
  t.openSearch();
  const card = t.store.get().game!.zones.library[5];
  t.store.dispatch(dropCommand([card], "graveyard"));
  t.store.dispatch(dropCommand([card], "library"));
  const game = t.store.get().game!;
  assert.equal(game.zones.library[0], card, "a drop on the library goes on top");
  assert.equal(game.zones.library.length, 60);
  assert.deepEqual(checkInvariants(game), []);
});

test("a peek lists only the peeked cards, and closing a peek never shuffles", () => {
  const t = setup();
  const game = t.store.get().game!;
  const top = overlayZoneIds(game, { zone: "library", mode: "peek", from: "top", count: 3 }, "library");
  const bottom = overlayZoneIds(game, { zone: "library", mode: "peek", from: "bottom", count: 3 }, "library");
  assert.deepEqual(top, game.zones.library.slice(0, 3));
  assert.deepEqual(bottom, game.zones.library.slice(-3));
  t.ui.set((s) => ({ ...s, dialog: "zone", zone: { zone: "library", mode: "peek", from: "top", count: 3 } }));
  closeZoneOverlay(t.store, t.ui, t.settings, t.seed);
  assert.equal(t.shuffleEvents(), 0);
});

test("the name filter is case-insensitive and ignores surrounding spaces", () => {
  const game = fixtureSixtyCardStart();
  const ids = game.zones.library;
  assert.equal(filterOverlayIds(game, ids, "  test card 7 ").length, 1);
  assert.equal(filterOverlayIds(game, ids, "").length, 60);
  assert.equal(filterOverlayIds(game, ids, "nope").length, 0);
});

test("dragging out of the overlay is opt-in and never for touch", () => {
  assert.equal(overlayDragEnabled({ keepSearchOpenWhileDragging: false }, "mouse"), false);
  assert.equal(overlayDragEnabled({ keepSearchOpenWhileDragging: true }, "mouse"), true);
  assert.equal(overlayDragEnabled({ keepSearchOpenWhileDragging: true }, "pen"), true);
  assert.equal(overlayDragEnabled({ keepSearchOpenWhileDragging: true }, "touch"), false);
});

test("opening another dialog while a library search is open resolves the shuffle once", () => {
  const t = setup({ keepSearchOpenWhileDragging: true });
  t.openSearch();
  const before = [...t.store.get().game!.zones.library];
  openDialog(t.store, t.ui, t.settings, t.seed, "settings");
  assert.equal(t.ui.get().dialog, "settings");
  assert.equal(t.ui.get().zone, null);
  assert.equal(t.shuffleEvents(), 1, "switching away from the search shuffles");
  assert.notDeepEqual(t.store.get().game!.zones.library, before);
  // Closing the new dialog, or a stray zone close, must not shuffle again.
  t.ui.set((s) => ({ ...s, dialog: null }));
  assert.equal(closeZoneOverlay(t.store, t.ui, t.settings, t.seed), false);
  assert.equal(t.shuffleEvents(), 1);
});

test("re-targeting the open search to a peek shuffles; asking for the same search again does not", () => {
  const t = setup();
  openDialog(t.store, t.ui, t.settings, t.seed, "zone", { zone: "library", mode: "search" });
  openDialog(t.store, t.ui, t.settings, t.seed, "zone", { zone: "library", mode: "search" });
  assert.equal(t.shuffleEvents(), 0, "same request: the sheet is only re-targeted");
  openDialog(t.store, t.ui, t.settings, t.seed, "zone", { zone: "library", mode: "peek", from: "top", count: 3 });
  assert.equal(t.shuffleEvents(), 1, "the search ended, so it shuffled");
  assert.deepEqual(t.ui.get().zone, { zone: "library", mode: "peek", from: "top", count: 3 });
  closeZoneOverlay(t.store, t.ui, t.settings, t.seed);
  assert.equal(t.shuffleEvents(), 1, "closing a peek never shuffles");
});

test("opening a dialog with no overlay open just opens it", () => {
  const t = setup();
  openDialog(t.store, t.ui, t.settings, t.seed, "settings");
  assert.equal(t.ui.get().dialog, "settings");
  assert.equal(t.shuffleEvents(), 0);
});
