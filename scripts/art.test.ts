/**
 * `artCropUrl` swaps one path segment in a Scryfall image URL. The one thing
 * worth pinning down is that it only touches the size segment Scryfall
 * documents as swappable, and leaves anything else (a null image, an
 * already-art_crop URL, an unrelated host) alone rather than mangling it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { artCropUrl } from "../src/lib/collection/art";

test("swaps normal for art_crop in a Scryfall image URL", () => {
  assert.equal(
    artCropUrl("https://cards.scryfall.io/normal/front/a/b/abc123.jpg"),
    "https://cards.scryfall.io/art_crop/front/a/b/abc123.jpg",
  );
});

test("swaps small or large the same way", () => {
  assert.equal(
    artCropUrl("https://cards.scryfall.io/small/front/a/b/abc123.jpg"),
    "https://cards.scryfall.io/art_crop/front/a/b/abc123.jpg",
  );
  assert.equal(
    artCropUrl("https://cards.scryfall.io/large/front/a/b/abc123.jpg"),
    "https://cards.scryfall.io/art_crop/front/a/b/abc123.jpg",
  );
});

test("a null image URI stays null", () => {
  assert.equal(artCropUrl(null), null);
});

test("a URL already at art_crop is left unchanged", () => {
  assert.equal(
    artCropUrl("https://cards.scryfall.io/art_crop/front/a/b/abc123.jpg"),
    "https://cards.scryfall.io/art_crop/front/a/b/abc123.jpg",
  );
});

test("a URL with no matching size segment is left unchanged", () => {
  assert.equal(
    artCropUrl("https://cards.scryfall.io/png/front/a/b/abc123.png"),
    "https://cards.scryfall.io/png/front/a/b/abc123.png",
  );
});
