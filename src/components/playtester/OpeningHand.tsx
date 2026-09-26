"use client";

import { useState } from "react";
import { CardArt } from "./CardArt";
import { useGame, usePlayStore } from "./hooks/useStore";
import { bottomsRequired } from "@/lib/playtest/board/reducers/zones";

/**
 * The opening hand: seven equal-size cards fanned out, no captions. Hover one
 * and it lifts and grows; click one to choose it for the bottom of the library
 * when a London mulligan asks for that (a numbered badge shows the order).
 * Keep and Mulligan sit above the fan so they are always on screen. The name and
 * the card details are on the hover (details column) and in the card's label for
 * screen readers.
 *
 * The fan turns each card slightly about a fixed point. The hover lift and grow
 * hang off the untransformed wrapper (`group/pick`), so the card never moves out
 * from under the pointer and flickers at its edge.
 */
export function OpeningHand() {
  const game = useGame();
  const store = usePlayStore();
  const [bottom, setBottom] = useState<string[]>([]);
  if (!game || game.opening.status !== "deciding") return null;
  const required = bottomsRequired(game);
  const selected = bottom.filter((id) => game.zones.hand.includes(id)).slice(0, required);
  const toggle = (id: string) => setBottom((old) => old.includes(id) ? old.filter((x) => x !== id) : old.length < required ? [...old, id] : old);
  const ids = game.zones.hand;
  const remaining = required - selected.length;
  return (
    <div className="absolute inset-0 z-[4500] flex items-center justify-center bg-black/80 p-4">
      <section role="dialog" aria-modal="true" aria-label="Opening hand" className="max-h-[94vh] w-full max-w-6xl overflow-x-hidden overflow-y-auto rounded-xl border border-border-strong bg-surface-raised p-4 sm:p-6">
        <h2 className="text-xl font-semibold">Opening hand</h2>
        <p className="mt-1 text-sm text-ink-muted" aria-live="polite">
          {game.opening.mulligans} mulligan{game.opening.mulligans === 1 ? "" : "s"} taken.{" "}
          {required > 0
            ? remaining > 0
              ? `Click ${remaining} more card${remaining === 1 ? "" : "s"} to put on the bottom of your library, in order.`
              : "Bottom cards chosen. Keep the hand when you are ready."
            : "Keep these seven, or mulligan and draw again."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {/* One size for all three, so the choice reads as a row of equals. */}
          <button type="button" className="w-40 rounded bg-accent px-4 py-2 text-center font-semibold text-accent-ink disabled:opacity-40 coarse:min-h-11" disabled={selected.length !== required} onClick={() => { store.dispatch({ type: "KEEP", bottomIds: selected }); setBottom([]); }}>
            Keep hand
          </button>
          <button type="button" className="w-40 rounded border border-border-strong px-4 py-2 text-center font-semibold coarse:min-h-11" onClick={() => { store.dispatch({ type: "MULLIGAN", seed: crypto.getRandomValues(new Uint32Array(1))[0] }); setBottom([]); }}>
            Mulligan
          </button>
          <button type="button" title="Draw a new seven without counting it: nothing extra to put on the bottom" className="w-40 rounded border border-border-strong px-4 py-2 text-center font-semibold coarse:min-h-11" onClick={() => { store.dispatch({ type: "MULLIGAN", seed: crypto.getRandomValues(new Uint32Array(1))[0], free: true }); setBottom([]); }}>
            Free mulligan
          </button>
        </div>
        <div className="flex items-end justify-center" style={{ padding: "4rem 1.5rem 2.5rem", minHeight: "16rem" }}>
          {ids.map((id, i) => {
            const card = game.cards[id];
            const order = selected.indexOf(id);
            const mid = (ids.length - 1) / 2;
            return (
              <div
                key={id}
                className="group/pick relative shrink-0 hover:z-30! focus-within:z-30!"
                style={{ width: "min(10rem, max(5.5rem, 12vw))", marginLeft: i === 0 ? 0 : "-1.25rem", transform: `rotate(${(i - mid) * 3}deg) translateY(${Math.abs(i - mid) * 5}px)`, zIndex: i }}
              >
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-label={`${card.name}${order >= 0 ? `, bottom choice ${order + 1}` : ""}`}
                  aria-pressed={order >= 0}
                  className="block w-full origin-bottom rounded-[5%] outline-none transition-transform duration-150 group-hover/pick:-translate-y-6 group-hover/pick:scale-125 focus-visible:-translate-y-6 focus-visible:scale-125 focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
                >
                  <CardArt src={card.imageNormal ?? card.imageSmall} alt={card.name} label={card.name} className={order >= 0 ? "opacity-60 ring-2 ring-accent" : ""} />
                  {order >= 0 ? <span className="absolute right-1 top-1 rounded-full bg-accent px-2 py-0.5 text-sm font-semibold text-accent-ink">{order + 1}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
