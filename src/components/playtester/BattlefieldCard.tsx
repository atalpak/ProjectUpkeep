"use client";

import { memo, useCallback } from "react";

import { CardArt } from "@/components/playtester/CardArt";
import { usePlayEnv } from "@/components/playtester/context";
import { useCard, useIsSelected, useSelector } from "@/components/playtester/hooks/useStore";
import { cx } from "@/lib/cx";
import { CARD_W } from "@/lib/playtest/board/layout";
import type { GameCard } from "@/lib/playtest/board/types";

/**
 * One card on the table. Memoised on primitives (id, position, stacking index,
 * scale) and subscribed to ITS OWN object, so tapping one card re-renders one
 * card, and moving a group re-renders that group's members only.
 *
 * Structure, and why it has three layers:
 *   wrapper  absolute-positioned by percentage of the board; the ONLY thing a
 *            drag touches (a translate3d written by drag.ts, no React);
 *   button   the focus/click target, with the full text description for screen
 *            readers (tap state, counters, notes are announced as text, not
 *            only drawn);
 *   turn     the rotating layer (tap = 90 degrees, plus any manual rotation),
 *            so the transition never fights the drag transform and the label
 *            under the card does not spin with it.
 *
 * The card art is the SMALL image; the normal one is only fetched by the
 * inspector. Overlays (counter chips, power/toughness, commander tax, note
 * dot, token badge) are sized in container-query units so they scale with the
 * board rather than with the window.
 */

export function describeCard(card: GameCard): string {
  const parts: string[] = [card.face === "face-down" ? "Face-down card" : card.name];
  if (card.tapped) parts.push("tapped");
  if (card.rotation !== 0) parts.push(`rotated ${card.rotation} degrees`);
  if (card.dimmed) parts.push("dimmed");
  if (card.face === "back") parts.push("showing its back face");
  for (const [name, count] of Object.entries(card.counters)) parts.push(`${count} ${name} counter${count === 1 ? "" : "s"}`);
  if (card.ptOffset.power !== 0 || card.ptOffset.toughness !== 0) parts.push(`power and toughness modified by ${signed(card.ptOffset.power)} and ${signed(card.ptOffset.toughness)}`);
  if (card.commanderTax > 0) parts.push(`commander tax ${card.commanderTax}`);
  if (card.note) parts.push("has a note");
  if (card.kind === "token") parts.push("token");
  if (card.kind === "copy") parts.push("copy");
  return parts.join(", ");
}

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

function statLine(card: GameCard): string | null {
  const hasBase = card.power !== null || card.toughness !== null;
  const modified = card.ptOffset.power !== 0 || card.ptOffset.toughness !== 0 || (card.counters["+1/+1"] ?? 0) !== 0 || (card.counters["-1/-1"] ?? 0) !== 0;
  if (!hasBase && !modified) return null;
  const plus = (card.counters["+1/+1"] ?? 0) - (card.counters["-1/-1"] ?? 0);
  const base = (v: string | null) => (v !== null && /^-?\d+$/.test(v) ? Number.parseInt(v, 10) : null);
  const p = base(card.power);
  const t = base(card.toughness);
  const power = p === null ? (card.power ?? "*") : p + card.ptOffset.power + plus;
  const toughness = t === null ? (card.toughness ?? "*") : t + card.ptOffset.toughness + plus;
  return `${power}/${toughness}`;
}

export type BattlefieldCardProps = {
  id: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  countersOnTop: boolean;
  registerEl: (id: string, el: HTMLElement | null) => void;
  onPointerDown: (event: React.PointerEvent, id: string) => void;
  onOpenMenu: (id: string, opener: HTMLElement, x: number, y: number) => void;
  onKey: (event: React.KeyboardEvent, id: string) => void;
  onToggleTapped: (id: string) => void;
};

export const BattlefieldCard = memo(function BattlefieldCard({
  id,
  x,
  y,
  z,
  scale,
  countersOnTop,
  registerEl,
  onPointerDown,
  onOpenMenu,
  onKey,
  onToggleTapped,
}: BattlefieldCardProps) {
  const env = usePlayEnv();
  const card = useCard(id);
  const selected = useIsSelected(id);
  const arrived = useSelector((s) => s.arrived.includes(id));
  const setRef = useCallback((el: HTMLDivElement | null) => registerEl(id, el), [registerEl, id]);
  if (!card) return null;

  // A glance feeds the card-details column and the small preview; it never
  // opens a dialog, so it cannot take the hover away from the card.
  const glance = (cardId: string) => env.ui.set((s) => (s.dragging ? s : { ...s, inspect: { cardId, big: false } }));
  const unglance = () => env.ui.set((s) => (s.inspect && !s.inspect.big ? { ...s, inspect: null } : s));
  const faceDown = card.face === "face-down";
  const src = faceDown ? null : card.face === "back" && card.imageBack ? card.imageBack : card.imageSmall;
  const turn = ((card.tapped ? 90 : 0) + card.rotation) % 360;
  const stat = faceDown ? null : statLine(card);
  const counters = Object.entries(card.counters);
  const label = describeCard(card);

  return (
    <div
      ref={setRef}
      data-card-wrapper={id}
      className={cx("group/card absolute touch-none hover:z-[1500]!", arrived && "pt-arrive")}
      style={{
        // The board fills the play area, so a stored position can leave a card
        // hanging off the bottom or right of a short, wide board. Clamp what is
        // DRAWN (a card is 1.4 times as tall as wide; cqw is 1% of the board's
        // width) so a card is always fully on the mat.
        left: `min(${x * 100}%, calc(100% - ${CARD_W * 100 * scale}cqw))`,
        top: `min(${y * 100}%, calc(100% - ${CARD_W * 140 * scale}cqw))`,
        width: `${CARD_W * 100 * scale}%`,
        zIndex: z + 1,
      }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") glance(id); }}
      onPointerLeave={() => unglance()}
      onFocusCapture={() => glance(id)}
    >
      <button
        type="button"
        data-card-id={id}
        aria-label={label}
        aria-pressed={selected}
        onPointerDown={(e) => onPointerDown(e, id)}
        onKeyDown={(e) => onKey(e, id)}
        onDoubleClick={() => onToggleTapped(id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenMenu(id, e.currentTarget, e.clientX, e.clientY);
        }}
        className={cx(
          "block w-full touch-none origin-center rounded-[5%] outline-none transition-transform duration-150 group-hover/card:scale-[1.14] motion-reduce:transition-none",
          "focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
          selected && "ring-2 ring-accent ring-offset-1 ring-offset-canvas",
        )}
      >
        <span className={cx("pt-turn relative block", card.dimmed && "opacity-45 grayscale")} style={{ transform: turn === 0 ? undefined : `rotate(${turn}deg)` }}>
          <CardArt src={src} alt={faceDown ? "Face-down card" : card.name} label={card.name} faceDown={faceDown} />

          {stat ? (
            <span className="absolute bottom-[3%] right-[3%] rounded-[3px] bg-black/75 px-[0.35em] text-[clamp(8px,1.05cqw,13px)] font-semibold leading-tight text-white" aria-hidden="true">
              {stat}
            </span>
          ) : null}

          {counters.length > 0 ? (
            <span className={cx("absolute left-[3%] flex max-w-[94%] flex-wrap gap-[2px]", countersOnTop ? "top-[3%]" : "bottom-[3%]")} aria-hidden="true">
              {counters.map(([name, count]) => (
                <span key={name} className="pt-pop rounded-full bg-accent px-[0.5em] text-[clamp(8px,1.05cqw,13px)] font-semibold leading-tight text-accent-ink shadow" title={`${count} ${name}`}>
                  {count === 1 && name.length > 6 ? name : `${count} ${name}`}
                </span>
              ))}
            </span>
          ) : null}

          {card.commanderTax > 0 ? (
            <span className="absolute right-[3%] top-[3%] rounded-full bg-black/75 px-[0.5em] text-[clamp(8px,1.05cqw,13px)] font-semibold leading-tight text-white" aria-hidden="true">
              +{card.commanderTax}
            </span>
          ) : null}
          {card.kind === "token" || card.kind === "copy" ? (
            <span className="absolute left-[3%] top-[45%] rounded-full bg-surface-inverse/80 px-[0.5em] text-[clamp(7px,0.9cqw,11px)] font-medium uppercase leading-tight tracking-wide text-inverse" aria-hidden="true">
              {card.kind === "copy" ? "Copy" : "Token"}
            </span>
          ) : null}
          {card.note ? <span className="absolute right-[3%] top-[12%] size-[9%] rounded-full border border-black/40 bg-accent" title="Has a note" aria-hidden="true" /> : null}
        </span>


      </button>

      {/* The touch-friendly menu button: always present, faint until hovered or
          focused, and always visible on a touch screen. */}
      <button
        type="button"
        aria-label={`Actions for ${faceDown ? "face-down card" : card.name}`}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onOpenMenu(id, e.currentTarget, box.left, box.bottom);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={cx(
          "absolute -right-[7%] -top-[5%] flex size-[16%] min-h-5 min-w-5 items-center justify-center rounded-full bg-surface-inverse/85 text-inverse shadow",
          "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 coarse:min-h-11 coarse:min-w-11 coarse:opacity-90",
        )}
      >
        <svg viewBox="0 0 16 16" className="size-[60%]" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
    </div>
  );
});
