/**
 * Which cards have a second face to flip to, and what that face looks like.
 *
 * Scryfall's `card_faces` array is present for every multi-faced card, and
 * that is the trap: a split card ("Fire // Ice"), an adventure ("Bonecrusher
 * Giant // Stomp") and a flip card all have two faces, but only some of them
 * are two *physical sides*. A split or adventure card is one picture with two
 * halves, so there is nothing to turn over, and a button that "flipped" it
 * would swap the picture for itself. The layout is what says which is which:
 * a card flips exactly when its faces are printed on opposite sides.
 *
 * Kept pure (a card's own fields in, a name and an address out) and in this
 * package so the web app and the phone app ask the same question and the
 * layout list lives in one place. The flipped state itself is component state
 * at each call site, never stored: see `useCardFace` (web and mobile).
 *
 * `card_faces` is optional on purpose. The phone's collection query does not
 * fetch it (it is the widest column on `cards`, and that query loads the whole
 * collection), so with the field absent a flip layout is taken to flip, the
 * back's name is the half of "Front // Back" after the slashes, and its picture
 * is the front's address with `front` changed to `back`. Where `card_faces` is
 * present it wins.
 *
 * The derivation was checked against Scryfall's API (2026-09-21): for every
 * card in the transform (1061), modal_dfc (327), double_faced_token (121) and
 * reversible_card (82) layouts that has per-face images, the stored back
 * address is exactly the front's with `front` swapped for `back`. Should that
 * ever stop holding, the hooks fall back to the front picture when the back
 * fails to load, so a wrong address costs a flip, never a blank card.
 */

/** Layouts whose faces are on opposite sides of the card. */
export const FLIP_LAYOUTS: ReadonlySet<string> = new Set([
  "transform",
  "modal_dfc",
  "double_faced_token",
  "reversible_card",
]);

type FaceImages = { small?: string; normal?: string; large?: string };

export type FlippableCard = {
  name: string;
  flavor_name?: string | null;
  layout: string | null;
  image_uri?: string | null;
  image_uri_small?: string | null;
  /** Absent (undefined) means "not fetched", which is different from null ("has none"). */
  card_faces?: ReadonlyArray<{ name?: string; image_uris?: FaceImages }> | null;
};

/** True when the card has two printed sides, so a flip control makes sense. */
export function isFlipCard(card: Pick<FlippableCard, "layout" | "card_faces">): boolean {
  if (!card.layout || !FLIP_LAYOUTS.has(card.layout)) return false;
  return card.card_faces === undefined || (card.card_faces?.length ?? 0) >= 2;
}

/**
 * The address of a face's picture, from its own `image_uris` when the sync
 * stored them. Scryfall serves a back face from the same path as the front
 * with `front` replaced by `back`, so when a face carries no addresses of its
 * own the back picture is derived from the front one rather than lost.
 */
function backImage(card: FlippableCard, size: "small" | "normal"): string | null {
  const own = card.card_faces?.[1]?.image_uris;
  const stored = size === "small" ? (own?.small ?? own?.normal) : (own?.normal ?? own?.large ?? own?.small);
  if (stored) return stored;
  const front = size === "small" ? (card.image_uri_small ?? card.image_uri) : (card.image_uri ?? card.image_uri_small);
  return front && front.includes("/front/") ? front.replace("/front/", "/back/") : null;
}

/**
 * What to draw for one side. `flipped` is ignored (front) for a card that does
 * not flip, and such a card is drawn exactly as every surface drew it before.
 * The back is the face's own name, or the half of "Front // Back" after the
 * slashes.
 */
export function faceView(
  card: FlippableCard,
  flipped: boolean,
  size: "small" | "normal",
): { name: string; image: string | null } {
  const frontImage =
    size === "small" ? (card.image_uri_small ?? card.image_uri ?? null) : (card.image_uri ?? card.image_uri_small ?? null);
  const flips = isFlipCard(card);
  // A flip card's stored name is both faces joined ("Front // Back"). Once the
  // card can be turned over, each side is named for itself, so the caption
  // changes with the picture; a card that cannot flip keeps its whole name.
  // A flavor name is the printed name of the whole card and is kept as is.
  const frontName = card.flavor_name
    ? `${card.name} (${card.flavor_name})`
    : flips
      ? (card.card_faces?.[0]?.name ?? card.name.split(" // ")[0] ?? card.name)
      : card.name;

  if (!flipped || !flips) return { name: frontName, image: frontImage };

  const name = card.card_faces?.[1]?.name ?? card.name.split(" // ")[1] ?? card.name;
  // A back with no picture at all keeps the front's rather than going blank.
  return { name, image: backImage(card, size) ?? frontImage };
}
