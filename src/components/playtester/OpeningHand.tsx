"use client";

import { useState } from "react";
import { CardArt } from "./CardArt";
import { usePlayEnv } from "./context";
import { useGame, usePlayStore } from "./hooks/useStore";
import { bottomsRequired } from "@/lib/playtest/board/reducers/zones";

/** London mulligan decisions are commands; the ordered list is the chosen bottom order. */
export function OpeningHand() {
  const game = useGame();
  const store = usePlayStore();
  const env = usePlayEnv();
  const [bottom, setBottom] = useState<string[]>([]);
  if (!game || game.opening.status !== "deciding") return null;
  const required = bottomsRequired(game);
  const selected = bottom.filter((id) => game.zones.hand.includes(id)).slice(0, required);
  const toggle = (id: string) => setBottom((old) => old.includes(id) ? old.filter((x) => x !== id) : old.length < required ? [...old, id] : old);
  return <div className="absolute inset-0 z-[4500] flex items-center justify-center bg-black/80 p-4"><section role="dialog" aria-modal="true" aria-label="Opening hand" className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-xl border border-border-strong bg-surface-raised p-4 sm:p-6"><h2 className="text-xl font-semibold">Opening hand</h2><p className="mt-1 text-sm text-ink-muted">{game.opening.mulligans} mulligans taken. {required > 0 ? `Choose ${required} card${required === 1 ? "" : "s"} to put on the bottom, in order.` : "Keep these seven, or mulligan and draw again."}</p><div className="my-5 flex flex-wrap justify-center gap-3 px-4 py-6 sm:flex-nowrap">{game.zones.hand.map((id) => { const card = game.cards[id]; const order = selected.indexOf(id); return <div key={id} className="group/pick relative w-28 transition-transform duration-150 hover:z-10 hover:-translate-y-3 hover:scale-110 focus-within:z-10 focus-within:-translate-y-3 focus-within:scale-110 motion-reduce:transition-none sm:w-auto sm:min-w-0 sm:max-w-[9.5rem] sm:flex-1"><button type="button" onClick={() => toggle(id)} aria-label={`${card.name}${order >= 0 ? `, bottom choice ${order + 1}` : ""}`} aria-pressed={order >= 0} className="w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-accent"><CardArt src={card.imageSmall} alt={card.name} label={card.name} /><span className="mt-1 block truncate text-xs">{card.name}</span>{order >= 0 ? <span className="absolute right-1 top-1 rounded-full bg-accent px-2 py-0.5 text-accent-ink">{order + 1}</span> : null}</button><button type="button" onClick={() => env.ui.set((s) => ({ ...s, inspect: { cardId: id, big: true } }))} className="mt-1 w-full rounded border border-white/20 py-1 text-xs coarse:min-h-11">Inspect</button></div>; })}</div><div className="flex flex-wrap gap-2"><button type="button" className="rounded bg-accent px-4 py-2 text-accent-ink coarse:min-h-11" disabled={selected.length !== required} onClick={() => { store.dispatch({ type: "KEEP", bottomIds: selected }); setBottom([]); }}>Keep hand</button><button type="button" className="rounded border border-white/30 px-4 py-2 coarse:min-h-11" onClick={() => { store.dispatch({ type: "MULLIGAN", seed: crypto.getRandomValues(new Uint32Array(1))[0] }); setBottom([]); }}>Mulligan</button></div></section></div>;
}
