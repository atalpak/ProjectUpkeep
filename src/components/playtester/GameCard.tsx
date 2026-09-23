"use client";

import Image from "next/image";
import { forwardRef } from "react";

import { cx } from "@/lib/cx";
import type { GameCard as GameCardModel } from "@/lib/playtest/board/types";

/**
 * The visual card itself — art, tapped rotation, face state, and a counters
 * badge. One component renders a card everywhere it appears (hand,
 * battlefield, zone piles, opening hand) so tapped/rotated/face-down/counter
 * treatment never drifts between them.
 *
 * A native `draggable` card, not a library-driven one — see `Hand.tsx` and
 * `Battlefield.tsx` for why plain HTML5 drag-and-drop is enough here: it is
 * one pointer gesture among several equally-supported ways to move a card
 * (the interaction contract, plan section 3.4, requires the others anyway),
 * so pulling in a drag-and-drop dependency for this alone isn't worth it.
 */
export const GameCard = forwardRef<
  HTMLButtonElement,
  {
    card: GameCardModel;
    size?: "sm" | "md" | "lg";
    selected?: boolean;
    faceDown?: boolean;
    draggable?: boolean;
    onDragStart?: (event: React.DragEvent) => void;
    onDragEnd?: (event: React.DragEvent) => void;
    /** Click/tap — selects the card (the interaction contract, plan 3.4). */
    onSelect: () => void;
    /** Enter/Space — opens the card's action menu. */
    onOpenMenu: () => void;
    /** Double-click/double-tap — toggles tapped state directly. Falls back to
     *  `onOpenMenu` where tapping means nothing (a hand or library card). */
    onToggleTapped?: () => void;
  }
>(function GameCard(
  {
    card,
    size = "md",
    selected = false,
    faceDown = false,
    draggable = false,
    onDragStart,
    onDragEnd,
    onSelect,
    onOpenMenu,
    onToggleTapped,
  },
  ref,
) {
  const dims = SIZES[size];
  const showBack = faceDown || card.face === "face-down";
  const rotationClass = ROTATION_CLASSES[card.rotation];
  const counterEntries = Object.entries(card.counters);

  return (
    <button
      ref={ref}
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onDoubleClick={() => (onToggleTapped ?? onOpenMenu)()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenMenu();
        }
      }}
      aria-label={`${card.name}${card.tapped ? ", tapped" : ""}${showBack ? ", face down" : ""}`}
      aria-pressed={selected}
      className={cx(
        "group relative shrink-0 cursor-default rounded-lg outline-none transition-transform duration-150 motion-reduce:transition-none coarse:min-h-11",
        selected && "ring-2 ring-accent ring-offset-2 ring-offset-canvas",
        "focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
      )}
    >
      <div className={cx(dims.box, "transition-transform duration-150 motion-reduce:transition-none", rotationClass)}>
        {showBack || !card.imageUri ? (
          <div
            className={cx(
              dims.box,
              "flex items-center justify-center rounded-lg border border-border-strong bg-surface-inverse/90 text-inverse",
            )}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
              {showBack ? "Face down" : card.name}
            </span>
          </div>
        ) : (
          <Image
            src={card.imageUri}
            alt=""
            width={dims.srcWidth}
            height={dims.srcHeight}
            unoptimized
            className={cx(dims.box, "rounded-lg object-cover shadow-[var(--shadow-card)]")}
          />
        )}
      </div>

      {card.kind === "token" ? (
        // "Copy" is implemented as a token under the hood (CREATE_TOKEN has
        // no distinct copy kind — see reduce.ts), which is an honest v1
        // simplification, not a hidden one: the badge says which it actually
        // is, using the "Copy of <name>" the copy action names it with
        // (CardMenu.tsx), so it never reads as a plain token to someone
        // reviewing the board or the action log later.
        <span
          className="absolute left-1 top-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-accent-ink"
          title={card.name.startsWith("Copy of ") ? "A token copy of another card" : "A token, not a real card"}
        >
          {card.name.startsWith("Copy of ") ? "Copy" : "Token"}
        </span>
      ) : null}

      {card.power !== null || card.toughness !== null ? (
        <span className="absolute bottom-1 right-1 rounded bg-surface-inverse/85 px-1 text-[9px] font-semibold text-inverse">
          {card.power ?? "*"}/{card.toughness ?? "*"}
        </span>
      ) : null}

      {counterEntries.length > 0 ? (
        <span className="absolute -top-1.5 left-1/2 flex -translate-x-1/2 flex-wrap justify-center gap-0.5">
          {counterEntries.map(([name, value]) => (
            <span
              key={name}
              className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold leading-none text-accent-ink shadow"
              title={name}
            >
              {value} {name}
            </span>
          ))}
        </span>
      ) : null}

      {card.note ? (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 size-3 rounded-full border border-surface bg-accent"
          title={card.note}
        />
      ) : null}

      <p className="mt-1 max-w-full truncate text-center text-[10px] text-ink-muted" style={{ width: dims.captionWidth }}>
        {card.name}
      </p>
    </button>
  );
});

const SIZES = {
  sm: { box: "h-20 w-14", srcWidth: 140, srcHeight: 196, captionWidth: "3.5rem" },
  md: { box: "h-28 w-20", srcWidth: 200, srcHeight: 280, captionWidth: "5rem" },
  lg: { box: "h-36 w-[6.5rem]", srcWidth: 260, srcHeight: 364, captionWidth: "6.5rem" },
} as const;

const ROTATION_CLASSES: Record<GameCardModel["rotation"], string> = {
  0: "rotate-0",
  90: "rotate-90",
  180: "rotate-180",
  270: "-rotate-90",
};
