"use client";

import { memo, useRef } from "react";

import { CardArt } from "@/components/playtester/CardArt";
import { HAND_WIDTH_REM } from "@/components/playtester/card-size";
import { useSettings, usePlayEnv, useUi } from "@/components/playtester/context";
import { startHandDrag } from "@/components/playtester/drag";
import { useCard, usePlayStore, useZoneIds } from "@/components/playtester/hooks/useStore";
import { useViewportHeight, useWidth } from "@/components/playtester/hooks/useWidth";
import { FloatingMenu } from "@/components/FloatingMenu";
import { cx } from "@/lib/cx";

/**
 * The hand: a row of cards with the count and the hand options above it (undo
 * and redo live in the top bar). It is a drop target (`data-drop="hand"`):
 * dropping a hand card back on it re-orders, dropping a table card on it
 * returns that card to the hand.
 *
 * Every hand card can be played four ways, none of them drag-only: click (when
 * the setting is "click plays"), Space (Shift+Space plays it tapped), the card
 * menu (Enter, right-click, or the dots button), or the number keys 1 to 9
 * (Shift plays tapped). Drag is a fifth, faster way for a pointer.
 *
 * "Hide hand" covers the pictures, never the hand: the cards stay in the tab
 * order with their real names for the owner, and a Show hand button is always
 * on screen. A setting that hid the game from its own player would be a bug.
 */

const GAP_PX = 8;

const HandCard = memo(function HandCard({
  id,
  index,
  widthRem,
  overlapPx,
  covered,
  hover,
  clickPlays,
  reduced,
}: {
  id: string;
  index: number;
  widthRem: number;
  overlapPx: number;
  covered: boolean;
  hover: boolean;
  clickPlays: boolean;
  reduced: boolean;
}) {
  const card = useCard(id);
  const store = usePlayStore();
  const env = usePlayEnv();
  const ref = useRef<HTMLDivElement>(null);
  if (!card) return null;

  function openMenu(opener: HTMLElement) {
    const box = opener.getBoundingClientRect();
    env.ui.set((s) => ({ ...s, menu: { cardId: id, x: box.left + box.width / 2, y: box.top, opener } }));
  }

  return (
    <div
      ref={ref}
      data-hand-card={id}
      className={cx("group/hand relative shrink-0 transition-transform duration-150 motion-reduce:transition-none", reduced && "!transition-none", hover && "hover:z-30! focus-within:z-30!")}
      style={{ width: `min(${widthRem}rem, 16vh)`, marginLeft: index === 0 ? 0 : -overlapPx, zIndex: index }}
      onFocusCapture={() => env.ui.set((s) => (s.dragging ? s : { ...s, inspect: { cardId: id, big: false } }))}
      onBlurCapture={() => env.ui.set((s) => (s.inspect && !s.inspect.big ? { ...s, inspect: null } : s))}
      onPointerEnter={(e) => {
        if (hover && e.pointerType === "mouse") env.ui.set((s) => (s.dragging ? s : { ...s, inspect: { cardId: id, big: false } }));
      }}
      onPointerLeave={() => env.ui.set((s) => (s.inspect && !s.inspect.big ? { ...s, inspect: null } : s))}
    >
      <button
        type="button"
        aria-label={`${card.name}${covered ? " (hand hidden)" : ""}, hand card ${index + 1}. Enter for actions, Space to play.`}
        onPointerDown={(e) => {
          if (!ref.current) return;
          const opener = e.currentTarget;
          startHandDrag(e, id, ref.current, { store, ui: env.ui, board: () => document.querySelector<HTMLElement>("[data-board]") }, () => {
            if (clickPlays) env.perform("play-card", id);
            // Pointerup precedes click. Mounting the backdrop now would let
            // the same click close the menu immediately.
            else window.setTimeout(() => openMenu(opener), 0);
          });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            openMenu(e.currentTarget);
          } else if (e.key === " ") {
            e.preventDefault();
            env.perform(e.shiftKey ? "play-card-tapped" : "play-card", id);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            const siblings = Array.from(document.querySelectorAll<HTMLElement>("[data-hand-card] > button"));
            const at = siblings.indexOf(e.currentTarget);
            siblings[at + (e.key === "ArrowLeft" ? -1 : 1)]?.focus();
            e.preventDefault();
          }
        }}
        className={cx("block w-full touch-none rounded-[5%] outline-none focus-visible:ring-2 focus-visible:ring-focus-ring", "origin-bottom transition-transform duration-150 motion-reduce:transition-none", hover && !reduced && "group-hover/hand:-translate-y-4 group-hover/hand:scale-110 focus-visible:-translate-y-4 focus-visible:scale-110", hover && reduced && "group-hover/hand:-translate-y-2")}
      >
        <CardArt src={card.imageSmall} alt={covered ? "Hidden hand card" : card.name} label={card.name} faceDown={covered} />
      </button>
    </div>
  );
});

function HandOptions() {
  const env = usePlayEnv();
  const hidden = useUi((s) => s.handHidden);
  const item = (id: string, label: string, close: () => void) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      onClick={() => {
        env.perform(id);
        close();
      }}
      className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-muted coarse:min-h-11"
    >
      {label}
    </button>
  );
  return (
    <FloatingMenu
      align="right"
      trigger={({ toggle, setTriggerRef, open }) => (
        <button ref={setTriggerRef} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="whitespace-nowrap rounded-md px-2 py-1 text-sm text-ink hover:bg-white/10 coarse:min-h-11">
          Hand options <span aria-hidden="true">⋮</span>
        </button>
      )}
      panelClassName="w-64 rounded-xl border border-border bg-surface-raised p-1.5 text-ink shadow-[var(--shadow-raised)]"
    >
      {({ close }) => (
        <div role="menu" aria-label="Hand options">
          {item("hand-overlay", "Show the whole hand", close)}
          {item("hand-hide", hidden ? "Show my hand" : "Hide my hand", close)}
          <p className="px-2.5 pt-1.5 text-xs font-medium text-ink-muted">Sort</p>
          {item("hand-sort-name", "By name", close)}
          {item("hand-sort-type", "By type", close)}
          {item("hand-sort-color", "By colour", close)}
          {item("hand-sort-mv", "By mana value", close)}
          <p className="px-2.5 pt-1.5 text-xs font-medium text-ink-muted">Move</p>
          {item("hand-random-discard", "Discard a random card", close)}
          {item("hand-all-to-graveyard", "Move the whole hand to the graveyard", close)}
          {item("hand-all-to-library", "Shuffle the hand into the library", close)}
        </div>
      )}
    </FloatingMenu>
  );
}

export function Hand() {
  const settings = useSettings();
  const ids = useZoneIds("hand");
  const hidden = useUi((s) => s.handHidden);
  const env = usePlayEnv();
  const areaRef = useRef<HTMLDivElement>(null);
  const areaWidth = useWidth(areaRef);
  const viewportHeight = useViewportHeight();

  const widthRem = HAND_WIDTH_REM[settings.handSize];
  const cardPx = viewportHeight === 0 ? widthRem * 16 : Math.min(widthRem * 16, viewportHeight * 0.16);
  const shown = ids.slice(0, settings.maxVisibleHand);
  const extra = ids.length - shown.length;
  // Squeeze the cards together only when they do not fit: the margin between
  // neighbours goes from a gap (-GAP_PX of overlap) to however negative it must
  // be for the whole row to fit. With auto size off the row scrolls instead.
  const fitOverlap = shown.length > 1 && areaWidth > 0 ? (shown.length * cardPx - areaWidth) / (shown.length - 1) : -GAP_PX;
  const overlapPx = settings.autoSize ? Math.max(-GAP_PX, fitOverlap) : -GAP_PX;
  const isDropTarget = useUi((s) => s.hoverZone === "hand");

  return (
    <section aria-label="Hand" className="min-w-0 flex-1">
      <div className="flex items-center justify-between px-1">
        <h2 className="whitespace-nowrap text-sm text-ink" aria-live="polite">
          Cards in hand: {ids.length}
        </h2>
        <div className="flex items-center gap-1">
          {hidden ? (
            <button type="button" onClick={() => env.perform("hand-hide")} className="rounded-md bg-accent px-2 py-1 text-sm font-medium text-accent-ink coarse:min-h-11">
              Show my hand
            </button>
          ) : null}
          <HandOptions />
        </div>
      </div>

      <div className="flex items-end gap-2">
        <div
          ref={areaRef}
          data-drop="hand"
          className={cx(
            "relative flex min-h-[clamp(7rem,27dvh,11rem)] min-w-0 flex-1 items-end justify-center rounded-lg pb-3 pt-2",
            settings.autoSize ? "overflow-visible" : "overflow-x-auto",
            isDropTarget && "ring-2 ring-accent ring-offset-2 ring-offset-transparent",
          )}
        >
          {ids.length === 0 ? <p className="self-center text-sm text-white/50">Your hand is empty.</p> : null}
          {shown.map((id, i) => (
            <HandCard key={id} id={id} index={i} widthRem={widthRem} overlapPx={overlapPx} covered={hidden} hover={settings.handHover} clickPlays={settings.handClick === "play"} reduced={settings.motion === "reduce"} />
          ))}
          {extra > 0 ? (
            <button type="button" onClick={() => env.perform("hand-overlay")} className="ml-2 shrink-0 self-center rounded-full bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25 coarse:min-h-11">
              +{extra} more
            </button>
          ) : null}
          {isDropTarget ? (
            <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold text-accent-ink" aria-hidden="true">
              Hand
            </span>
          ) : null}
        </div>

      </div>
    </section>
  );
}
