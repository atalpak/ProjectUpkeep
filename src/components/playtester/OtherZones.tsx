"use client";

import { useEffect, useRef } from "react";

import { CardArt } from "./CardArt";
import { startHandDrag } from "./drag";
import { usePlayEnv } from "./context";
import { useCard, usePlayStore, useZoneIds } from "./hooks/useStore";

/**
 * The two zones that are not the table or a pile: the command zone (one card
 * space per commander, so normally one) and the sideboard (a space with its
 * cards listed underneath, when there are any). Every card opens the same card
 * menu as anywhere else, which has every move; hovering one feeds the details
 * column.
 */

function useCardActions(id: string) {
  const env = usePlayEnv();
  const glance = () => env.ui.set((s) => (s.dragging ? s : { ...s, inspect: { cardId: id, big: false } }));
  const unglance = () => env.ui.set((s) => (s.inspect && !s.inspect.big ? { ...s, inspect: null } : s));
  const openMenu = (opener: HTMLElement) => {
    const box = opener.getBoundingClientRect();
    env.ui.set((s) => ({ ...s, menu: { cardId: id, x: box.left, y: box.bottom, opener } }));
  };
  const store = usePlayStore();
  // Press and drag lifts the card onto the table (or a pile or the hand); a plain
  // click opens its menu. The dialog fades out while a card is in flight so the
  // table underneath can be dropped on, and closes once the card has left.
  const startDrag = (e: React.PointerEvent, zone: "command" | "sideboard", source: HTMLElement, onClick: () => void) =>
    startHandDrag(e, id, source, { store, ui: env.ui, board: () => document.querySelector<HTMLElement>("[data-board]") }, onClick, zone);
  return { glance, unglance, openMenu, startDrag };
}

function CommanderSlot({ id }: { id: string }) {
  const card = useCard(id);
  const { glance, unglance, openMenu, startDrag } = useCardActions(id);
  const wrap = useRef<HTMLDivElement>(null);
  if (!card) return null;
  return (
    <div ref={wrap} className="w-[var(--pt-card,8rem)]">
    <button
      type="button"
      data-drop="command"
      onPointerDown={(e) => { if (wrap.current) startDrag(e, "command", wrap.current, () => window.setTimeout(() => openMenu(e.currentTarget), 0)); }}
      aria-label={`${card.name}, command zone. Enter for actions.`}
      onClick={(e) => { if (e.detail === 0) openMenu(e.currentTarget); }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.currentTarget);
      }}
      onPointerEnter={glance}
      onPointerLeave={unglance}
      onFocus={glance}
      className="block w-full origin-bottom rounded-md text-left outline-none transition-transform duration-150 hover:-translate-y-1 hover:scale-105 focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
    >
      <CardArt src={card.imageSmall} alt={card.name} label={card.name} />
    </button>
    </div>
  );
}

function SideboardRow({ id }: { id: string }) {
  const card = useCard(id);
  const { glance, unglance, openMenu, startDrag } = useCardActions(id);
  if (!card) return null;
  return (
    <li>
      <button
        type="button"
        onPointerDown={(e) => startDrag(e, "sideboard", e.currentTarget, () => window.setTimeout(() => openMenu(e.currentTarget), 0))}
        onClick={(e) => { if (e.detail === 0) openMenu(e.currentTarget); }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.currentTarget);
        }}
        onPointerEnter={glance}
        onPointerLeave={unglance}
        onFocus={glance}
        className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-focus-ring coarse:min-h-11"
      >
        {card.name}
      </button>
    </li>
  );
}

export function OtherZonesPanel() {
  const env = usePlayEnv();
  const command = useZoneIds("command");
  const sideboard = useZoneIds("sideboard");
  const total = command.length + sideboard.length;
  const before = useRef(total);
  useEffect(() => {
    // A card was dragged out (or moved by its menu): the panel has done its job.
    if (total < before.current && env.ui.get().dialog === "zones") env.ui.set((s) => ({ ...s, dialog: null }));
    before.current = total;
  }, [total, env]);
  return (
    <div className="space-y-6 text-sm">
      <section aria-label="Command zone">
        <h3 className="mb-2 font-semibold">Command zone</h3>
        {command.length === 0 ? (
          <div className="flex aspect-[5/7] w-[var(--pt-card,8rem)] items-center justify-center rounded-md bg-white/5 text-ink-muted" data-drop="command">
            Empty
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {command.map((id) => (
              <CommanderSlot key={id} id={id} />
            ))}
          </div>
        )}
      </section>
      <section aria-label="Sideboard">
        <h3 className="mb-2 font-semibold">Sideboard ({sideboard.length})</h3>
        {sideboard.length === 0 ? (
          <p className="text-ink-muted">No cards in the sideboard.</p>
        ) : (
          <ul className="max-h-[40vh] space-y-0.5 overflow-auto">
            {sideboard.map((id) => (
              <SideboardRow key={id} id={id} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
