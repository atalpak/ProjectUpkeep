"use client";

import { CardArt } from "./CardArt";
import { usePlayEnv } from "./context";
import { useCard, useZoneIds } from "./hooks/useStore";

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
  return { glance, unglance, openMenu };
}

function CommanderSlot({ id }: { id: string }) {
  const card = useCard(id);
  const { glance, unglance, openMenu } = useCardActions(id);
  if (!card) return null;
  return (
    <button
      type="button"
      data-drop="command"
      aria-label={`${card.name}, command zone. Enter for actions.`}
      onClick={(e) => openMenu(e.currentTarget)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.currentTarget);
      }}
      onPointerEnter={glance}
      onPointerLeave={unglance}
      onFocus={glance}
      className="w-32 origin-bottom rounded-md text-left outline-none transition-transform duration-150 hover:-translate-y-1 hover:scale-105 focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
    >
      <CardArt src={card.imageSmall} alt={card.name} label={card.name} />
    </button>
  );
}

function SideboardRow({ id }: { id: string }) {
  const card = useCard(id);
  const { glance, unglance, openMenu } = useCardActions(id);
  if (!card) return null;
  return (
    <li>
      <button
        type="button"
        onClick={(e) => openMenu(e.currentTarget)}
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
  const command = useZoneIds("command");
  const sideboard = useZoneIds("sideboard");
  return (
    <div className="space-y-6 text-sm">
      <section aria-label="Command zone">
        <h3 className="mb-2 font-semibold">Command zone</h3>
        {command.length === 0 ? (
          <div className="flex aspect-[5/7] w-32 items-center justify-center rounded-md bg-white/5 text-ink-muted" data-drop="command">
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
