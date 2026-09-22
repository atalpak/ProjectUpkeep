"use client";

import { useState } from "react";

import { faceView, isFlipCard, type FlippableCard } from "@/lib/cards/faces";
import { cx } from "@/components/ui";

/**
 * The flipped/unflipped state of one card image on screen, and the name and
 * picture that go with it.
 *
 * Deliberately just `useState`: the requirement is that a card is back on its
 * front the next time it is seen, and the simplest thing that guarantees it is
 * to never store the choice anywhere. Leaving the page, closing the popup or
 * re-rendering the tile from a fresh query unmounts the component and the
 * state goes with it. A tile that shares its caption with its picture (the name
 * under a collection tile) calls this once and hands both what they need, so
 * the two cannot disagree about which side is showing.
 *
 * `card` is null-tolerant because several rows carry no printing (a card that
 * has since left the catalog); those simply cannot flip.
 */
export function useCardFace(card: FlippableCard | null | undefined, size: "small" | "normal") {
  // Which card the state belongs to. A tile whose card prop changes (a list
  // re-sorted under a stable key, a draft switching printing) starts on its
  // front again instead of showing the old card's flipped side.
  const key = card ? `${card.name}|${card.image_uri ?? ""}|${card.image_uri_small ?? ""}` : "";
  const [state, setState] = useState({ key, flipped: false, backFailed: false });
  let current = state;
  if (state.key !== key) {
    current = { key, flipped: false, backFailed: false };
    setState(current);
  }

  const canFlip = !!card && isFlipCard(card);
  const flipped = canFlip && current.flipped;
  const front = card ? faceView(card, false, size) : null;
  const shown = card ? faceView(card, flipped, size) : null;
  return {
    canFlip,
    flipped,
    flip: () => setState((s) => ({ ...s, key, flipped: !s.flipped })),
    /** The side's name; null when there is no card at all. */
    name: shown?.name ?? null,
    /** The side's picture; the front's if the back's address failed to load. */
    image: flipped && current.backFailed ? (front?.image ?? null) : (shown?.image ?? null),
    /** Hand to the image's `onError`: a back that will not load falls back to the front. */
    onImageError: () => {
      if (flipped) setState((s) => ({ ...s, key, backFailed: true }));
    },
    /** Name of the side a flip would show, for the button's label. */
    otherName: card && canFlip ? faceView(card, !flipped, size).name : null,
  };
}

/**
 * The flip control, a small round button that sits over the corner of a card
 * image. It must be a sibling of the tile's own button or link, never a child:
 * a tile is usually clickable (it opens the card popup) and a button inside a
 * button is invalid and swallows the click. The parent wraps both in a
 * `relative` box.
 *
 * 44px on a touch screen (the `coarse:` variant, per the app's tap-target
 * rule), a compact 28px with a mouse so it does not cover the art.
 */
export function FlipButton({
  onFlip,
  otherName,
  className,
}: {
  onFlip: () => void;
  /** The face a press will show; it is what the label announces. */
  otherName: string | null;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        // Never let the press reach a tile handler behind it (a preview target
        // or a row that toggles selection).
        event.stopPropagation();
        onFlip();
      }}
      aria-label={otherName ? `Flip card to ${otherName}` : "Flip card"}
      title={otherName ? `Flip to ${otherName}` : "Flip card"}
      className={cx(
        "absolute right-1.5 top-1.5 z-10 inline-flex size-7 items-center justify-center rounded-full border border-border bg-surface/90 text-ink shadow transition-colors hover:bg-surface-muted coarse:size-11",
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    </button>
  );
}
