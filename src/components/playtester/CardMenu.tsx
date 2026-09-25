"use client";

import { useEffect, useRef } from "react";
import { usePlayEnv, useUi } from "./context";
import { useCard, usePlayStore, useSelector } from "./hooks/useStore";
import type { ZoneId } from "@/lib/playtest/board/types";

const DESTINATIONS: ZoneId[] = ["battlefield", "hand", "graveyard", "exile", "library", "command", "sideboard", "temporary"];
/** One menu for every card and zone. Closing restores the opener's focus. */
export function CardMenu() {
  const env = usePlayEnv(); const store = usePlayStore(); const target = useUi((s) => s.menu); const card = useCard(target?.cardId ?? "");
  const zone = useSelector((s) => target && s.game ? DESTINATIONS.find((z) => s.game!.zones[z].includes(target.cardId)) ?? null : null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (target) ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [target]);
  if (!target || !card || !zone) return null;
  const close = () => { env.ui.set((s) => ({ ...s, menu: null })); target.opener?.focus(); };
  const action = (fn: () => void) => { fn(); close(); };
  const move = (to: ZoneId, at: "top" | "bottom" = "top") => action(() => store.dispatch({ type: "MOVE_MANY", ids: [card.id], to, at }));
  const item = (label: string, fn: () => void) => <button key={label} type="button" role="menuitem" onClick={() => action(fn)} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10 coarse:min-h-11">{label}</button>;
  return <><div className="fixed inset-0 z-[6000]" onClick={close} /><div ref={ref} role="menu" aria-label={`${card.name} actions`} className="fixed z-[6001] max-h-[70vh] w-64 overflow-auto rounded-xl border border-white/20 bg-[#25231f] p-1 text-white shadow-2xl" style={{ left: Math.min(target.x, window.innerWidth - 270), top: Math.min(target.y, window.innerHeight - 360) }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}><p className="truncate px-3 py-2 text-sm font-semibold">{card.name}</p>{zone === "hand" ? <>{item("Play", () => env.perform("play-card", card.id))}{item("Play tapped", () => env.perform("play-card-tapped", card.id))}{item("Play face down", () => store.dispatch({ type: "MOVE_MANY", ids: [card.id], to: "battlefield", at: "top", faceDown: true }))}</> : null}{zone === "battlefield" ? <>{item(card.tapped ? "Untap" : "Tap", () => store.dispatch({ type: "SET_TAPPED", cardId: card.id, tapped: !card.tapped }))}{item("Add +1/+1 counter", () => store.dispatch({ type: "ADD_COUNTER", cardId: card.id, name: "+1/+1", delta: 1 }))}{item("Remove +1/+1 counter", () => store.dispatch({ type: "ADD_COUNTER", cardId: card.id, name: "+1/+1", delta: -1 }))}{item("Turn face down / up", () => store.dispatch({ type: "SET_FACE", cardId: card.id, face: card.face === "face-down" ? "front" : "face-down" }))}{item("Rotate", () => store.dispatch({ type: "SET_ROTATION", cardId: card.id, rotation: ((card.rotation + 90) % 360) as 0 | 90 | 180 | 270 }))}{item("Dim / undim", () => store.dispatch({ type: "SET_CARD_FLAGS", ids: [card.id], flags: { dimmed: !card.dimmed } }))}</> : null}{item("Inspect card", () => env.ui.set((s) => ({ ...s, inspect: { cardId: card.id, big: true } })))}<div className="my-1 border-t border-white/15" />{DESTINATIONS.filter((z) => z !== zone).map((to) => <button key={to} role="menuitem" onClick={() => move(to)} className="block w-full rounded px-3 py-2 text-left text-sm capitalize hover:bg-white/10 coarse:min-h-11">Move to {to}</button>)}{zone !== "library" ? <button role="menuitem" onClick={() => move("library", "bottom")} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10 coarse:min-h-11">Bottom of library</button> : null}{card.kind !== "deck-card" ? item("Delete extra card", () => store.dispatch({ type: "DELETE_OBJECT", cardId: card.id })) : null}</div></>;
}
