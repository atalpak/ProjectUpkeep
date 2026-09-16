/**
 * The illustration alone, no frame or text — for a deck tile's background,
 * where a whole card (a rectangle of white border and rules text) reads as
 * clutter rather than atmosphere.
 *
 * Derived from the whole-card URL already on hand rather than fetched or
 * stored separately: every Scryfall card image lives at
 * `cards.scryfall.io/<version>/front/<a>/<b>/<id>.jpg`, where `<version>` is
 * one of `small` / `normal` / `large` / `art_crop` / ... — swapping that one
 * path segment is Scryfall's own documented way to get a different crop of
 * the same image, not a guess about their CDN's internals.
 *
 * Its own module rather than living on `LocationManager.tsx` (where it
 * started): that file is `"use client"`, and `ProfilePublicDecks.tsx` — a
 * Server Component — needs this too. Importing a plain function from a
 * client-marked file fails at runtime ("Attempted to call artCropUrl() from
 * the server but artCropUrl is on the client"), not at build time, so this
 * split is load-bearing, not tidiness.
 */
export function artCropUrl(imageUri: string | null): string | null {
  if (!imageUri) return null;
  return imageUri.replace(/\/(?:small|normal|large)\/front\//, "/art_crop/front/");
}
