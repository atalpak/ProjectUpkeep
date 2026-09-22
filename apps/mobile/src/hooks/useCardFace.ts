import { useState } from 'react';
import { faceView, isFlipCard } from '@upkeep/domain';

/**
 * The flipped/unflipped state of one card picture on screen, and the name and
 * picture that go with it. The mobile twin of the web app's `useCardFace`
 * (src/components/cards/FlipCard.tsx); the rules (which layouts flip, what the
 * back is called and where its picture is) are `@upkeep/domain`'s `faceView`.
 *
 * Plain `useState` on purpose: a card must be back on its front the next time
 * it is seen, and never storing the choice guarantees it. Leaving the screen,
 * closing a sheet or a list recycling the row unmounts the component and the
 * state with it.
 *
 * The phone's list queries do not fetch `card_faces` (the widest column, on a
 * query that loads the whole collection), only the short `layout`, so the back
 * is derived from the front's name and address. A source with no `layout`
 * cannot flip.
 */
export type FlipSource = {
  name: string;
  layout?: string | null;
  image?: string | null;
  imageSmall?: string | null;
};

export function useCardFace(card: FlipSource | null | undefined, size: 'small' | 'normal') {
  // The state belongs to one card: if the card prop changes (a recycled row, a
  // re-sorted list) it starts on its front again rather than showing the old
  // card's flipped side.
  const key = card ? `${card.name}|${card.image ?? ''}|${card.imageSmall ?? ''}` : '';
  const [state, setState] = useState({ key, flipped: false, backFailed: false });
  let current = state;
  if (state.key !== key) { current = { key, flipped: false, backFailed: false }; setState(current); }

  const flippable = card ? {
    name: card.name, layout: card.layout ?? null, image_uri: card.image ?? null, image_uri_small: card.imageSmall ?? null,
  } : null;
  const canFlip = !!flippable && isFlipCard(flippable);
  const flipped = canFlip && current.flipped;
  const front = flippable ? faceView(flippable, false, size) : null;
  const shown = flippable ? faceView(flippable, flipped, size) : null;
  return {
    canFlip,
    flipped,
    flip: () => setState(s => ({ ...s, key, flipped: !s.flipped })),
    /** The shown side's name; null when there is no card. */
    name: shown?.name ?? null,
    /** The shown side's picture; the front's if the back's address failed to load. */
    image: flipped && current.backFailed ? front?.image ?? null : shown?.image ?? null,
    /** Hand to the Image's `onError`: a back that will not load falls back to the front, never a blank card. */
    onImageError: () => { if (flipped) setState(s => ({ ...s, key, backFailed: true })); },
    /** The side a press will show, for the button's spoken label. */
    otherName: flippable && canFlip ? faceView(flippable, !flipped, size).name : null,
  };
}
