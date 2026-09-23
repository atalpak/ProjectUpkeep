"use client";

import { useState } from "react";

import { CardMenu } from "@/components/playtester/CardMenu";
import { GameCard } from "@/components/playtester/GameCard";
import type { GameCommand } from "@/lib/playtest/board/commands";
import { getBattlefieldGroups } from "@/lib/playtest/board/selectors";
import type { GameCard as GameCardModel, GameState } from "@/lib/playtest/board/types";

/**
 * The battlefield: rows/groups, not a free x/y canvas (plan section 8's own
 * decision table — the architect's impact map resolved the plan's flagged
 * "two representations" risk by putting a card's group on the card itself,
 * `GameCard.groupId`; see `board/types.ts`). Each row is one group — `null`
 * is the always-present "ungrouped" row — rendered as a wrapping shelf of
 * cards. A card joins a row either by being dragged onto it or by the "Move
 * to <group>" section of its own `CardMenu`, which is also the entire
 * keyboard path: select the card, press Enter, choose a destination.
 */
export function Battlefield({
  state,
  dispatch,
  selectedId,
  onSelect,
}: {
  state: GameState;
  dispatch: (command: GameCommand) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const groups = getBattlefieldGroups(state);
  const groupIds = [...groups.keys()].filter((id): id is string => id !== null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Always show the ungrouped row, even empty, so there is somewhere obvious
  // to drop a card back out of a named group.
  const rows: Array<[string | null, GameCardModel[]]> = [
    [null, groups.get(null) ?? []],
    ...groupIds.map((id): [string, GameCardModel[]] => [id, groups.get(id) ?? []]),
  ];

  return (
    <div className="min-h-[16rem] space-y-3 rounded-xl border border-border bg-surface-raised p-3">
      {rows.map(([groupId, cards]) => (
        <BattlefieldRow
          key={groupId ?? "ungrouped"}
          groupId={groupId}
          cards={cards}
          groupIds={groupIds}
          dispatch={dispatch}
          selectedId={selectedId}
          onSelect={onSelect}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
        />
      ))}
    </div>
  );
}

function BattlefieldRow({
  groupId,
  cards,
  groupIds,
  dispatch,
  selectedId,
  onSelect,
  menuFor,
  setMenuFor,
}: {
  groupId: string | null;
  cards: GameCardModel[];
  groupIds: string[];
  dispatch: (command: GameCommand) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={
        "min-h-[7.5rem] rounded-lg border border-dashed border-border p-2 transition-colors " +
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
        if (cardId) dispatch({ type: "MOVE_CARD", cardId, to: "battlefield", index: null, groupId });
      }}
    >
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {groupId ?? "Ungrouped"}
      </p>
      <div className="flex flex-wrap gap-2">
        {cards.map((card) => (
          <div key={card.id} className="relative">
            <GameCard
              card={card}
              selected={selectedId === card.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/game-card-id", card.id)}
              onSelect={() => onSelect(card.id)}
              onOpenMenu={() => setMenuFor(card.id)}
              onToggleTapped={() => dispatch({ type: "SET_TAPPED", cardId: card.id, tapped: !card.tapped })}
            />
            <CardMenu
              card={card}
              zone="battlefield"
              groupIds={groupIds}
              dispatch={dispatch}
              open={menuFor === card.id}
              onOpenChange={(open) => setMenuFor(open ? card.id : null)}
              trigger={({ setTriggerRef }) => <span ref={setTriggerRef as never} className="absolute inset-0 -z-10" />}
            />
          </div>
        ))}
        {cards.length === 0 ? <p className="px-1 py-2 text-xs text-ink-muted">Drop a card here</p> : null}
      </div>
    </div>
  );
}
