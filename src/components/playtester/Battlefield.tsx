"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";

import { BattlefieldCard } from "@/components/playtester/BattlefieldCard";
import { nudge } from "@/components/playtester/board-actions";
import { useSettings, usePlayEnv, useUi } from "@/components/playtester/context";
import { createBoardDrag, DROP_LABELS } from "@/components/playtester/drag";
import { GroupFrame } from "@/components/playtester/GroupFrame";
import { useFit } from "@/components/playtester/hooks/useFit";
import { useGame, usePlayStore } from "@/components/playtester/hooks/useStore";
import { cx } from "@/lib/cx";
import { BOARD_ASPECT, cardRect, readingOrder, resolvedPositions } from "@/lib/playtest/board/layout";
import { CARD_SCALE } from "@/lib/playtest/settings";
import type { GameState } from "@/lib/playtest/board/types";

/**
 * The free-placement table.
 *
 * A fixed 16:9 virtual board scaled to fit the room (`useFit`); every card is
 * placed by proportion (board/layout.ts), so a resize or a 200% zoom cannot
 * move anything. This component re-renders on any game change (it needs the
 * resolved positions) but does almost nothing when it does: each card is a
 * memoised component that subscribes to its own object and takes only
 * primitives from here, so 100 cards do not repaint because one was tapped.
 *
 * Moving things: drag (drag.ts), box-select on empty table, and the same moves
 * by keyboard (arrow-key nudges merged into one undo step, Enter for the card
 * menu, Space to select) and by menu. A pointer is never the only way.
 *
 * DOM order is READING order (top to bottom, then left to right) so Tab visits
 * the table the way a person reads it; stacking is the explicit z-index from
 * `zones.battlefield`, which is a different thing and never affected by it.
 */

const GuideLines = memo(function GuideLines() {
  const guides = useUi((s) => s.guides);
  return (
    <>
      {guides.x !== null ? <div className="pointer-events-none absolute inset-y-0 w-px bg-accent/80" style={{ left: `${guides.x * 100}%` }} aria-hidden="true" /> : null}
      {guides.y !== null ? <div className="pointer-events-none absolute inset-x-0 h-px bg-accent/80" style={{ top: `${guides.y * 100}%` }} aria-hidden="true" /> : null}
    </>
  );
});

function DropBadge({ zone }: { zone: string }) {
  const hover = useUi((s) => s.hoverZone);
  if (hover !== zone) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[3000] flex items-start justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 pt-3" aria-hidden="true">
      <span className="rounded-full bg-accent px-3 py-1 text-sm font-semibold text-accent-ink shadow">{DROP_LABELS[zone]}</span>
    </div>
  );
}

function boxOf(game: GameState, gid: string, positions: Map<string, { x: number; y: number }>) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of game.zones.battlefield) {
    const card = game.cards[id];
    const pos = positions.get(id);
    if (!card || card.groupId !== gid || !pos) continue;
    const r = cardRect(card, pos);
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export function Battlefield() {
  const store = usePlayStore();
  const env = usePlayEnv();
  const settings = useSettings();
  const game = useGame();

  const areaRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const [els] = useState(() => new Map<string, HTMLElement>());
  const fit = useFit(areaRef, BOARD_ASPECT);

  const registerEl = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (el) els.set(id, el);
      else els.delete(id);
    },
    [els],
  );

  const drag = useMemo(
    () =>
      createBoardDrag({
        store,
        ui: env.ui,
        board: () => boardRef.current,
        els,
        marquee: () => marqueeRef.current,
        reducedMotion: () => false,
      }),
    [store, env.ui, els],
  );

  const openMenu = useCallback(
    (id: string, opener: HTMLElement, x: number, y: number) => env.ui.set((s) => ({ ...s, menu: { cardId: id, x, y, opener } })),
    [env.ui],
  );

  const onKey = useCallback(
    (event: React.KeyboardEvent, id: string) => {
      if (event.ctrlKey || event.metaKey) return;
      if (event.key === "Enter") {
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        openMenu(id, event.currentTarget as HTMLElement, box.left + box.width / 2, box.bottom);
      } else if (event.key === " ") {
        event.preventDefault();
        store.toggleSelected(id);
      } else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 0.05 : event.altKey ? 0.002 : 0.01;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const selection = store.get().selection;
        // Equal PIXEL steps in both directions: a fraction of the board's
        // height is BOARD_ASPECT times a fraction of its width.
        nudge(store, selection.includes(id) ? selection : [id], dx, dy * BOARD_ASPECT);
      }
    },
    [openMenu, store],
  );

  const toggleTapped = useCallback(
    (id: string) => {
      const card = store.get().game?.cards[id];
      if (!card) return;
      const selection = store.get().selection;
      const ids = selection.includes(id) ? [...selection] : [id];
      store.dispatch({ type: "SET_CARD_FLAGS", ids, flags: { tapped: !card.tapped } });
    },
    [store],
  );

  const scale = CARD_SCALE[settings.cardSize];
  const ordered = useMemo(() => (game ? readingOrder(game, game.zones.battlefield) : []), [game]);
  const positions = useMemo(() => (game ? resolvedPositions(game) : new Map()), [game]);
  const zIndex = useMemo(() => {
    const map = new Map<string, number>();
    game?.zones.battlefield.forEach((id, i) => map.set(id, i));
    return map;
  }, [game]);
  const groupBoxes = useMemo(() => {
    if (!game) return [];
    return Object.entries(game.groups)
      .map(([gid, group]) => ({ gid, group, box: boxOf(game, gid, positions) }))
      .filter((g): g is { gid: string; group: typeof g.group; box: NonNullable<typeof g.box> } => g.box !== null);
  }, [game, positions]);

  if (!game) return null;
  const empty = game.zones.battlefield.length === 0;

  return (
    <div ref={areaRef} className="relative flex min-h-0 flex-1 items-center justify-center p-1.5 sm:p-2">
      <div
        ref={boardRef}
        data-drop="battlefield"
        data-board
        onPointerDown={drag.onBoardPointerDown}
        className={cx(
          "relative touch-none select-none overflow-hidden rounded-xl border border-white/10 [container-type:inline-size]",
          fit.width === 0 && "invisible",
        )}
        style={{ width: fit.width, height: fit.height, background: "var(--mat-tint, transparent)" }}
        role="group"
        aria-label={`Battlefield, ${game.zones.battlefield.length} card${game.zones.battlefield.length === 1 ? "" : "s"}`}
      >
        {empty ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/45">
            The table is empty. Drag a card here from your hand, or select it and press Enter for its menu.
          </p>
        ) : null}

        {groupBoxes.map(({ gid, group, box }) => (
          <GroupFrame key={`${gid}:${group.label}`} groupId={gid} label={group.label} arrangement={group.arrangement} x={box.x} y={box.y} w={box.w} h={box.h} />
        ))}

        {ordered.map((id) => {
          const pos = positions.get(id);
          if (!pos) return null;
          return (
            <BattlefieldCard
              key={id}
              id={id}
              x={pos.x}
              y={pos.y}
              z={zIndex.get(id) ?? 0}
              scale={scale}
              showLabels={settings.showLabels}
              countersOnTop={settings.countersOnTop}
              registerEl={registerEl}
              onPointerDown={drag.onCardPointerDown}
              onOpenMenu={openMenu}
              onKey={onKey}
              onToggleTapped={toggleTapped}
            />
          );
        })}

        <div ref={marqueeRef} hidden className="pointer-events-none absolute z-[2500] border border-accent bg-accent/15" />
        <GuideLines />
        <DropBadge zone="battlefield" />
      </div>
    </div>
  );
}
