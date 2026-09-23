"use client";

import { useState } from "react";

import { CardMenu } from "@/components/playtester/CardMenu";
import { GameCard } from "@/components/playtester/GameCard";
import type { GameCommand } from "@/lib/playtest/board/commands";
import { getZone } from "@/lib/playtest/board/selectors";
import type { GameState } from "@/lib/playtest/board/types";

/**
 * The hand: a fanned, overlapping row (plan section 3.2). Reordering is
 * plain drag-and-drop within the row; every card's `CardMenu` also offers
 * "Move to <zone>" directly, which is the keyboard-only and touch-only path
 * onto the battlefield or any other zone (interaction contract, section 3.4
 * — dragging is one way in, never the only one).
 */
export function Hand({
  state,
  dispatch,
  selectedId,
  onSelect,
  bottomSelection,
}: {
  state: GameState;
  dispatch: (command: GameCommand) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Non-null only during a London mulligan's bottom-selection step (see
   *  `GameControls.tsx`'s mulligan flow) — while set, clicking a card toggles
   *  it for the bottom instead of selecting it for the normal card menu. */
  bottomSelection?: {
    toBottom: number;
    selected: Set<string>;
    onToggle: (cardId: string) => void;
  } | null;
}) {
  const cards = getZone(state, "hand");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div
      className="flex min-h-[8rem] flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (bottomSelection) return;
        const cardId = e.dataTransfer.getData("text/game-card-id");
        if (cardId) dispatch({ type: "MOVE_CARD", cardId, to: "hand", index: dragOverIndex });
        setDragOverIndex(null);
      }}
    >
      {cards.length === 0 ? <p className="px-2 py-4 text-sm text-ink-muted">Your hand is empty.</p> : null}
      {cards.map((card, index) => (
        <div
          key={card.id}
          className="relative"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverIndex(index);
          }}
        >
          <GameCard
            card={card}
            selected={bottomSelection ? bottomSelection.selected.has(card.id) : selectedId === card.id}
            draggable={!bottomSelection}
            onDragStart={(e) => e.dataTransfer.setData("text/game-card-id", card.id)}
            onSelect={() => (bottomSelection ? bottomSelection.onToggle(card.id) : onSelect(card.id))}
            onOpenMenu={() => (bottomSelection ? bottomSelection.onToggle(card.id) : setMenuFor(card.id))}
          />
          {bottomSelection ? null : (
            <CardMenu
              card={card}
              zone="hand"
              groupIds={[]}
              dispatch={dispatch}
              open={menuFor === card.id}
              onOpenChange={(open) => setMenuFor(open ? card.id : null)}
              trigger={({ setTriggerRef }) => <span ref={setTriggerRef as never} className="absolute inset-0 -z-10" />}
            />
          )}
        </div>
      ))}
    </div>
  );
}
