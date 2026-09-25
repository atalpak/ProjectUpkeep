"use client";

import { useEffect, useState } from "react";
import { CardArt } from "./CardArt";
import { usePlayEnv, useUi } from "./context";
import { useCard } from "./hooks/useStore";
import { textFor } from "@/lib/playtest/catalog";

export function CardInspector() {
  const env = usePlayEnv(); const inspect = useUi((s) => s.inspect); const card = useCard(inspect?.cardId ?? ""); const [fetched, setFetched] = useState<{ id: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!card?.cardId || env.catalog.has(card.cardId)) return;
    const controller = new AbortController();
    fetch(`/api/cards/${encodeURIComponent(card.cardId)}`, { signal: controller.signal }).then((r) => r.ok ? r.json() : null).then((v) => { if (v?.card) setFetched({ id: card.cardId!, text: v.card.oracle_text ?? null }); }).catch(() => {});
    return () => controller.abort();
  }, [card?.cardId, env.catalog]);
  if (!inspect || !card) return null;
  const text = textFor(env.catalog.get(card.cardId ?? ""), card.face === "back" ? "back" : "front");
  const close = () => env.ui.set((s) => ({ ...s, inspect: null }));
  return <div className="fixed inset-0 z-[6500] flex items-center justify-center bg-black/75 p-4" onClick={close}><div role="dialog" aria-label={`${card.name} details`} className="flex max-h-[90vh] max-w-3xl flex-col gap-4 overflow-auto rounded-xl bg-[#25231f] p-4 text-white sm:flex-row" onClick={(e) => e.stopPropagation()}><div className="w-48 shrink-0 sm:w-64"><CardArt src={card.imageNormal ?? card.imageSmall} alt={card.name} label={card.name} faceDown={card.face === "face-down"} /></div><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><h2 className="text-lg font-semibold">{card.name}</h2><button onClick={close} aria-label="Close card details">✕</button></div><p className="text-sm text-white/60">{text?.manaCost} · {text?.typeLine ?? card.typeLine}</p><p className="mt-3 whitespace-pre-wrap text-sm">{text?.text ?? (fetched?.id === card.cardId ? fetched.text : null) ?? "No oracle text available."}</p><p className="mt-3 text-xs">{card.tapped ? "Tapped" : "Untapped"} · {card.face === "face-down" ? "Face down" : card.face}</p></div></div></div>;
}
