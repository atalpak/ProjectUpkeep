/**
 * Tests for which cards flip, and what the other side shows.
 *
 * Run with: npx tsx --test scripts/faces.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { FLIP_LAYOUTS, faceView, isFlipCard, type FlippableCard } from "../src/lib/cards/faces";

const front = "https://cards.scryfall.io/normal/front/a/b/abc.jpg?1";
const frontSmall = "https://cards.scryfall.io/small/front/a/b/abc.jpg?1";

const delver: FlippableCard = {
  name: "Delver of Secrets // Insectile Aberration",
  layout: "transform",
  image_uri: front,
  image_uri_small: frontSmall,
  card_faces: [
    { name: "Delver of Secrets", image_uris: { normal: front, small: frontSmall } },
    {
      name: "Insectile Aberration",
      image_uris: {
        normal: "https://cards.scryfall.io/normal/back/a/b/abc.jpg?1",
        small: "https://cards.scryfall.io/small/back/a/b/abc.jpg?1",
      },
    },
  ],
};

test("transform, modal and reversible layouts flip", () => {
  for (const layout of ["transform", "modal_dfc", "reversible_card", "double_faced_token"]) {
    assert.equal(isFlipCard({ ...delver, layout }), true, layout);
  }
});

test("split, adventure and other one-picture layouts do not, even with two faces", () => {
  for (const layout of ["split", "adventure", "flip", "meld", "normal", "saga", null]) {
    assert.equal(isFlipCard({ ...delver, layout }), false, String(layout));
  }
});

test("a flip layout with only one stored face does not flip", () => {
  assert.equal(isFlipCard({ ...delver, card_faces: [delver.card_faces![0]!] }), false);
  assert.equal(isFlipCard({ ...delver, card_faces: null }), false);
});

test("the front of a flip card is named for the front face, in the requested size", () => {
  assert.deepEqual(faceView(delver, false, "normal"), { name: "Delver of Secrets", image: front });
  assert.equal(faceView(delver, false, "small").image, frontSmall);
});

test("a flavor name is kept as the whole card's printed name", () => {
  assert.equal(faceView({ ...delver, flavor_name: "Bug" }, false, "normal").name, `${delver.name} (Bug)`);
});

test("a card that does not flip keeps its whole name", () => {
  const adventure: FlippableCard = { ...delver, layout: "adventure", name: "Bonecrusher Giant // Stomp" };
  assert.equal(faceView(adventure, false, "normal").name, "Bonecrusher Giant // Stomp");
});

test("the back shows the other face's name and its own picture", () => {
  assert.deepEqual(faceView(delver, true, "normal"), {
    name: "Insectile Aberration",
    image: "https://cards.scryfall.io/normal/back/a/b/abc.jpg?1",
  });
  assert.equal(faceView(delver, true, "small").image, "https://cards.scryfall.io/small/back/a/b/abc.jpg?1");
});

test("a back with no stored picture is derived from the front's address", () => {
  const bare: FlippableCard = { ...delver, card_faces: [{ name: "Delver of Secrets" }, { name: "Insectile Aberration" }] };
  assert.equal(faceView(bare, true, "normal").image, "https://cards.scryfall.io/normal/back/a/b/abc.jpg?1");
});

test("a back that cannot be found keeps the front picture rather than going blank", () => {
  const odd: FlippableCard = {
    ...delver,
    image_uri: "https://img.example/x.jpg",
    image_uri_small: null,
    card_faces: [{ name: "A" }, { name: "B" }],
  };
  assert.equal(faceView(odd, true, "normal").image, "https://img.example/x.jpg");
});

test("with no face name the back name is the half after the slashes", () => {
  const unnamed: FlippableCard = { ...delver, card_faces: [{}, {}] };
  assert.equal(faceView(unnamed, true, "normal").name, "Insectile Aberration");
});

test("asking to flip a card that does not flip returns the front", () => {
  const split: FlippableCard = { ...delver, layout: "split", name: "Fire // Ice" };
  assert.deepEqual(faceView(split, true, "normal"), { name: "Fire // Ice", image: front });
});

test("with card_faces not fetched, a flip layout flips on its name and address alone", () => {
  const light: FlippableCard = {
    name: "Delver of Secrets // Insectile Aberration",
    layout: "transform",
    image_uri: front,
    image_uri_small: frontSmall,
  };
  assert.equal(isFlipCard(light), true);
  assert.deepEqual(faceView(light, false, "normal"), { name: "Delver of Secrets", image: front });
  assert.deepEqual(faceView(light, true, "small"), {
    name: "Insectile Aberration",
    image: "https://cards.scryfall.io/small/back/a/b/abc.jpg?1",
  });
  assert.equal(isFlipCard({ ...light, layout: "adventure" }), false);
});

test("exactly these layouts flip", () => {
  assert.deepEqual([...FLIP_LAYOUTS].sort(), ["double_faced_token", "modal_dfc", "reversible_card", "transform"]);
  // Art-series cards have two faces but are not a card you turn over.
  assert.equal(isFlipCard({ ...delver, layout: "art_series" }), false);
});

test("a stored back address wins over the derived one, whatever its path", () => {
  // A reversible-style back whose address is NOT the front's with the side swapped.
  const other = "https://cards.scryfall.io/normal/back/z/y/zzz-different-id.jpg?9";
  const reversible: FlippableCard = {
    ...delver,
    layout: "reversible_card",
    card_faces: [{ name: "A" }, { name: "A", image_uris: { normal: other, small: other } }],
  };
  assert.equal(faceView(reversible, true, "normal").image, other);
  assert.notEqual(other, front.replace("/front/", "/back/"));
});
