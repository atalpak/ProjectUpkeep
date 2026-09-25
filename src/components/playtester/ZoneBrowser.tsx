"use client";

import { useRef, useState } from "react";
import { usePlayEnv, useSettings, useUi } from "./context";
import { CardArt } from "./CardArt";
import { startHandDrag } from "./drag";
import { useGame, usePlayStore } from "./hooks/useStore";
import { filterOverlayIds, overlayDragEnabled, overlayZoneIds, shouldShuffleOnClose } from "./zone-overlay";
import { cx } from "@/lib/cx";
import { ZONE_IDS, ZONE_LABELS, type ZoneId } from "@/lib/playtest/board/types";

/**
 * The zone overlay: browse, search or peek at one zone.
 *
 * With "keep search open while dragging" on, `docked` is true: the overlay is a
 * side sheet, not a modal, and a card in it can be picked up with a mouse or pen
 * and dropped on the battlefield, the hand or a pile while the sheet stays open.
 * The sheet closes only when the player closes it, and that is the one moment
 * the shuffle-on-close choice is resolved (zone-overlay.ts).
 *
 * Dragging is never the only way: the card's menu (click, or Enter from the
 * keyboard) has every move, and touch uses the menu because a finger on a
 * scrolling list cannot tell a drag from a scroll.
 */
export function ZoneBrowser({ onClose, docked }: { onClose: () => void; docked: boolean }) {
  const game = useGame();
  const env = usePlayEnv();
  const store = usePlayStore();
  const settings = useSettings();
  const request = useUi((s) => s.zone);
  const dragging = useUi((s) => s.dragging);
  const [filter, setFilter] = useState("");
  const [zoneOverride, setZoneOverride] = useState<ZoneId | null>(null);
  // A pointer press already opened the menu (or started a drag); the click that
  // follows it must not open it a second time. Keyboard clicks have no press.
  const pressed = useRef(false);
  if (!game || !request) return null;
  const zone = zoneOverride ?? request.zone;
  const shown = filterOverlayIds(game, overlayZoneIds(game, request, zone), filter);
  const shuffles = zone === "library" && shouldShuffleOnClose(request, settings.shuffleOnClose);

  function openMenu(id: string, opener: HTMLElement) {
    const box = opener.getBoundingClientRect();
    env.ui.set((s) => ({ ...s, menu: { cardId: id, x: box.left, y: box.bottom, opener } }));
  }

  return (
    <div className={cx("space-y-3", docked && "flex min-h-0 flex-1 flex-col space-y-0 gap-3")}>
      <div className="flex gap-2">
        <select aria-label="Zone" value={zone} onChange={(e) => setZoneOverride(e.target.value as ZoneId)} className="rounded bg-black/40 p-2">
          {ZONE_IDS.filter((z) => z !== "temporary" || game.zones.temporary.length > 0 || zone === "temporary").map((z) => <option key={z} value={z}>{ZONE_LABELS[z]} ({game.zones[z].length})</option>)}
        </select>
        <input aria-label="Search zone" placeholder="Search cards" value={filter} onChange={(e) => setFilter(e.target.value)} className="min-w-0 flex-1 rounded bg-black/40 p-2" />
      </div>
      {docked ? <p className="text-xs text-ink-muted">Drag a card onto the table, your hand or a pile. This stays open until you press Done.</p> : null}
      <div className={cx("grid gap-2 overflow-auto", docked ? "min-h-0 flex-1 grid-cols-3 content-start" : "max-h-[55vh] grid-cols-2 sm:grid-cols-4")}>
        {shown.map((id) => {
          const card = game.cards[id];
          return (
            <div key={id} data-zone-card={id} className="relative rounded">
              <button
                type="button"
                aria-label={`${card.name}, ${ZONE_LABELS[zone]}. Press Enter for actions${docked ? ", or drag it out" : ""}.`}
                onPointerDown={(e) => {
                  if (!overlayDragEnabled(settings, e.pointerType) || !e.currentTarget.parentElement) return;
                  const button = e.currentTarget;
                  pressed.current = true;
                  const release = () => {
                    window.removeEventListener("pointerup", release);
                    window.removeEventListener("pointercancel", release);
                    window.setTimeout(() => { pressed.current = false; }, 0);
                  };
                  window.addEventListener("pointerup", release);
                  window.addEventListener("pointercancel", release);
                  startHandDrag(
                    e,
                    id,
                    button.parentElement!,
                    { store, ui: env.ui, board: () => document.querySelector<HTMLElement>("[data-board]") },
                    () => window.setTimeout(() => openMenu(id, button), 0),
                    zone,
                  );
                }}
                onClick={(e) => {
                  if (pressed.current) return;
                  openMenu(id, e.currentTarget);
                }}
                className={cx("block w-full rounded p-1 text-left hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-focus-ring coarse:min-h-11", overlayDragEnabled(settings, "mouse") && !dragging && "cursor-grab")}
              >
                <CardArt src={card.imageSmall} alt={card.name} label={card.name} />
                <span className="block truncate text-xs">{card.name}</span>
              </button>
            </div>
          );
        })}
      </div>
      {shown.length === 0 ? <p className="text-ink-muted">No cards</p> : null}
      <button type="button" onClick={onClose} className="rounded bg-accent px-4 py-2 text-accent-ink coarse:min-h-11">
        Done{shuffles ? " · shuffle library" : ""}
      </button>
    </div>
  );
}
