"use client";

import { useRef, useState } from "react";

import { CardArt } from "./CardArt";
import { usePlayEnv, useUi } from "./context";
import { useCard, useZoneIds } from "./hooks/useStore";
import { ArrowUpIcon, KebabIcon } from "./icons";
import { FloatingMenu } from "@/components/FloatingMenu";
import { cx } from "@/lib/cx";

/**
 * Library, graveyard and exile: a header with the count and a menu, and a
 * card-sized slot below it. Each slot is a drop target (`data-drop`), so a card
 * dragged from the table, the hand or the zone overlay can land on a pile, and
 * the same moves are in the pile's menu and the card menu for anyone not
 * dragging. The library shows the sleeve; the other two show their top card,
 * which is the newest one (moves to those piles go to the end of the list).
 */

type PileZone = "library" | "graveyard" | "exile";

const LABEL: Record<PileZone, string> = { library: "Library", graveyard: "Graveyard", exile: "Exile" };

type Item = { id: string; label: string; arg?: number };

const MENU: Record<PileZone, Item[]> = {
  library: [
    { id: "draw", label: "Draw a card" },
    { id: "draw-n", label: "Draw 3 cards", arg: 3 },
    { id: "search-library", label: "Search the library" },
    { id: "shuffle", label: "Shuffle the library" },
    { id: "peek-top", label: "Look at the top 3", arg: 3 },
    { id: "peek-bottom", label: "Look at the bottom 3", arg: 3 },
    { id: "mill", label: "Mill a card" },
    { id: "random-draw", label: "Draw a random card" },
    { id: "top-to-graveyard", label: "Top card to the graveyard" },
  ],
  graveyard: [{ id: "view-graveyard", label: "View the graveyard" }],
  exile: [{ id: "view-exile", label: "View the exile zone" }],
};

function PileMenu({ zone, count, open, onOpenChange }: { zone: PileZone; count: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const env = usePlayEnv();
  return (
    <FloatingMenu
      align="left"
      open={open}
      onOpenChange={onOpenChange}
      trigger={({ toggle, setTriggerRef, open }) => (
        <button
          ref={setTriggerRef}
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${LABEL[zone]} options, ${count} cards`}
          className="flex w-full items-center justify-between gap-1 rounded px-0.5 text-xs text-ink-muted hover:bg-white/10 hover:text-ink @[8rem]:text-sm coarse:min-h-11"
        >
          <span className="truncate whitespace-nowrap">
            {LABEL[zone]} <span className="@max-[6.5rem]:hidden">({count})</span>
          </span>
          <KebabIcon className="size-4 shrink-0 @max-[6.5rem]:hidden" />
        </button>
      )}
      panelClassName="w-56 rounded-xl border border-border bg-surface-raised p-1.5 text-ink shadow-[var(--shadow-raised)]"
    >
      {({ close }) => (
        <div role="menu" aria-label={`${LABEL[zone]} options`}>
          {MENU[zone].map((item) => (
            <button
              key={item.id + (item.arg ?? "")}
              type="button"
              role="menuitem"
              onClick={() => {
                env.perform(item.id, item.arg ?? null);
                close();
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-muted coarse:min-h-11"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </FloatingMenu>
  );
}

function TopCard({ id }: { id: string }) {
  const card = useCard(id);
  if (!card) return null;
  return <CardArt src={card.imageSmall} alt={card.name} label={card.name} className="size-full" />;
}

function Pile({ zone }: { zone: PileZone }) {
  const env = usePlayEnv();
  const ids = useZoneIds(zone);
  const hovered = useUi((s) => s.hoverZone === zone);
  const count = ids.length;
  const topId = zone === "library" ? null : ids[ids.length - 1] ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  // The library reads as a deck you touch: a click draws, holding shows the back
  // large for as long as it is held, right-click opens the same menu as the
  // header. The other piles open their cards on a click. A keyboard press
  // (click with no pointer, `detail` 0) does the same as a click.
  const hold = useRef<{ timer: number; held: boolean } | null>(null);
  const end = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
    env.ui.set((s) => (s.backPreview ? { ...s, backPreview: false } : s));
  };
  const activate = () => env.perform(zone === "library" ? "draw" : `view-${zone}`);

  return (
    <div className="@container relative flex w-[max(4.25rem,min(6.6rem,9vw,18dvh))] shrink-0 flex-col gap-1">
      <PileMenu zone={zone} count={count} open={menuOpen} onOpenChange={setMenuOpen} />
      <button
        type="button"
        data-drop={zone}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        onPointerDown={zone === "library" ? (e) => {
          if (e.button !== 0 || count === 0) return;
          const state = { held: false, timer: 0 };
          state.timer = window.setTimeout(() => {
            state.held = true;
            env.ui.set((s) => ({ ...s, backPreview: true }));
          }, 450);
          hold.current = state;
        } : undefined}
        onPointerUp={zone === "library" ? () => {
          const state = hold.current;
          const wasHeld = state?.held === true;
          const started = state !== null;
          end();
          if (started && !wasHeld) activate();
        } : undefined}
        onPointerLeave={zone === "library" ? end : undefined}
        onPointerCancel={zone === "library" ? end : undefined}
        onClick={(e) => {
          // Pointer clicks are handled above for the library; a keyboard press has no pointer.
          if (zone === "library" && e.detail !== 0) return;
          activate();
        }}
        aria-label={count > 0 ? `${LABEL[zone]}, ${count} cards. ${zone === "library" ? "Draw a card. Hold to look at the back." : "View cards."}` : `${LABEL[zone]}, no cards.`}
        className={cx(
          "relative aspect-[5/7] w-full overflow-hidden rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          count === 0 ? "bg-white/5 text-ink-muted hover:bg-white/10" : "hover:brightness-110",
          hovered && "ring-2 ring-accent",
        )}
      >
        {count === 0 ? (
          <span className="absolute inset-0 flex items-center justify-center">No cards</span>
        ) : zone === "library" ? (
          <CardArt src={null} alt="Library" label="Library" faceDown className="size-full" />
        ) : topId ? (
          <TopCard id={topId} />
        ) : null}
        {count > 0 ? (
          <span aria-hidden="true" className="absolute bottom-1 left-1 rounded bg-black/65 px-1 text-xs @[6.5rem]:hidden">
            {count}
          </span>
        ) : null}
        {hovered ? (
          <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded-full bg-accent px-2 py-0.5 text-center text-xs font-semibold text-accent-ink" aria-hidden="true">
            {zone === "library" ? "Top of library" : LABEL[zone]}
          </span>
        ) : null}
      </button>
    </div>
  );
}

export function Piles() {
  return (
    <div className="flex shrink-0 items-start gap-3 pb-2 pt-1">
      <Pile zone="library" />
      <Pile zone="graveyard" />
      <Pile zone="exile" />
    </div>
  );
}

/** The docked tab on the right edge that opens the other zones (command,
 *  sideboard, stack). It is the whole height of the strip, like a drawer handle. */
export function OtherZonesTab() {
  const env = usePlayEnv();
  return (
    <button
      type="button"
      onClick={() => env.perform("view-zones")}
      className="flex w-8 shrink-0 items-center justify-center gap-2 self-stretch rounded-l-lg bg-surface-raised text-sm text-ink-muted hover:text-ink [writing-mode:vertical-rl] rotate-180 coarse:w-11 max-sm:mb-2 max-sm:min-h-11 max-sm:w-auto max-sm:flex-1 max-sm:rotate-0 max-sm:self-end max-sm:rounded-lg max-sm:px-3 max-sm:[writing-mode:horizontal-tb]"
    >
      <span>View other zones</span>
      <ArrowUpIcon className="size-4" />
    </button>
  );
}
