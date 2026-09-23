"use client";

import { useState } from "react";

import { CardMenu } from "@/components/playtester/CardMenu";
import { GameCard } from "@/components/playtester/GameCard";
import { Button } from "@/components/ui";
import type { GameCommand } from "@/lib/playtest/board/commands";
import { getZone } from "@/lib/playtest/board/selectors";
import type { GameState, ZoneId } from "@/lib/playtest/board/types";

/**
 * A quiet zone — library, graveyard, exile, or command — shown as a count
 * plus a peek list, per plan section 3.2 ("zones are always available but
 * visually quiet"). Every card in the peek list opens the same `CardMenu`
 * everything else does, so returning a card from the graveyard or exile is
 * never a special path.
 */
export function ZonePile({
  zone,
  label,
  state,
  dispatch,
  onDrop,
  extraActions,
}: {
  zone: ZoneId;
  label: string;
  state: GameState;
  dispatch: (command: GameCommand) => void;
  /** Called when a card dragged from elsewhere is dropped on this pile. */
  onDrop: (cardId: string) => void;
  /** Zone-specific buttons (draw, shuffle, mill) rendered above the peek list. */
  extraActions?: React.ReactNode;
}) {
  const cards = getZone(state, zone);
  const [peekOpen, setPeekOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={
        "space-y-2 rounded-xl border border-border bg-surface p-2.5 transition-colors " +
        (dragOver ? "border-accent-text bg-surface-muted" : "")
      }
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const cardId = e.dataTransfer.getData("text/game-card-id");
        if (cardId) onDrop(cardId);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
        <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
          {cards.length}
        </span>
      </div>

      {extraActions ? <div className="flex flex-wrap gap-1.5">{extraActions}</div> : null}

      {cards.length > 0 ? (
        <Button type="button" variant="ghost" className="w-full !justify-start px-1 py-1 text-xs" onClick={() => setPeekOpen((v) => !v)}>
          {peekOpen ? "Hide" : "Search"} ({cards.length})
        </Button>
      ) : null}

      {/* Every card in the zone, not just the top few — plan section 3.3's
          "search/reveal" is manual ("show the library and let the player
          choose"), not a peek at the top of the deck, and this is the only
          way a fetch-land or tutor effect can actually be resolved. The list
          scrolls (max-h-56) rather than paginating; a full deck is at most
          ~100 cards, cheap to render as plain <li> rows. */}
      {peekOpen ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {cards.map((card) => (
            <li key={card.id} className="relative flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-surface-muted">
              <span className="min-w-0 truncate text-sm">{card.name}</span>
              <CardMenu
                card={card}
                zone={zone}
                groupIds={[]}
                dispatch={dispatch}
                open={menuFor === card.id}
                onOpenChange={(open) => setMenuFor(open ? card.id : null)}
                trigger={({ toggle, setTriggerRef }) => (
                  <button
                    ref={setTriggerRef as never}
                    type="button"
                    onClick={toggle}
                    aria-haspopup="menu"
                    aria-label={`Actions for ${card.name}`}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface hover:text-ink coarse:min-h-11"
                  >
                    Actions
                  </button>
                )}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A single card used as a compact drag/drop-and-menu affordance — the
 *  command-zone commander tile, shown large since there is usually exactly
 *  one card in it. */
export function SingleCardZone({
  zone,
  label,
  state,
  dispatch,
}: {
  zone: ZoneId;
  label: string;
  state: GameState;
  dispatch: (command: GameCommand) => void;
}) {
  const cards = getZone(state, zone);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={
        "space-y-2 rounded-xl border border-border bg-surface p-2.5 transition-colors " +
        (dragOver ? "border-accent-text bg-surface-muted" : "")
      }
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const cardId = e.dataTransfer.getData("text/game-card-id");
        if (cardId) dispatch({ type: "MOVE_CARD", cardId, to: zone, index: null });
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {cards.map((card) => (
          <div key={card.id} className="relative">
            <GameCard
              card={card}
              size="sm"
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/game-card-id", card.id)}
              onSelect={() => setMenuFor(card.id)}
              onOpenMenu={() => setMenuFor(card.id)}
            />
            <CardMenu
              card={card}
              zone={zone}
              groupIds={[]}
              dispatch={dispatch}
              open={menuFor === card.id}
              onOpenChange={(open) => setMenuFor(open ? card.id : null)}
              trigger={({ setTriggerRef }) => <span ref={setTriggerRef as never} className="absolute inset-0" />}
            />
          </div>
        ))}
        {cards.length === 0 ? <p className="text-xs text-ink-muted">Empty</p> : null}
      </div>
    </div>
  );
}
