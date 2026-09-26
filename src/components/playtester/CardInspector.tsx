"use client";

import { useEffect, useState } from "react";
import { CardArt } from "./CardArt";
import { usePlayEnv, useSettings, useUi } from "./context";
import { useCard, useZoneIds } from "./hooks/useStore";
import { textFor } from "@/lib/playtest/catalog";

export function CardInspector() {
  const env = usePlayEnv(); const settings = useSettings(); const inspect = useUi((s) => s.inspect); const backPreview = useUi((s) => s.backPreview); const libraryCount = useZoneIds("library").length; const card = useCard(inspect?.cardId ?? ""); const [fetched, setFetched] = useState<{ id: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!card?.cardId || env.catalog.has(card.cardId)) return;
    const controller = new AbortController();
    fetch(`/api/cards/${encodeURIComponent(card.cardId)}`, { signal: controller.signal }).then((r) => r.ok ? r.json() : null).then((v) => { if (v?.card) setFetched({ id: card.cardId!, text: v.card.oracle_text ?? null }); }).catch(() => {});
    return () => controller.abort();
  }, [card?.cardId, env.catalog]);
  // Holding the library shows its back, large, for as long as it is held. It
  // shows the back and the count, never the top card: the library is hidden.
  if (backPreview) return <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[6500] flex flex-col items-center justify-center gap-3 bg-black/60"><div className="w-56 sm:w-72"><CardArt src={null} alt="Library" label="Library" faceDown /></div><p className="rounded-full bg-surface-raised px-4 py-1 text-sm text-ink">Library · {libraryCount} card{libraryCount === 1 ? "" : "s"}</p></div>;
  if (!inspect || !card) return null;
  const text = textFor(env.catalog.get(card.cardId ?? ""), card.face === "back" ? "back" : "front");
  const close = () => env.ui.set((s) => ({ ...s, inspect: null }));
  // A hover is a glance, not a dialog. It must never cover the pointer: a
  // full-screen layer under the mouse takes the hover away, which dismisses it,
  // which gives the hover back, and the box flickers. So the hover preview is a
  // small picture at the side with pointer events off, and only the deliberate
  // inspect (long press, the I key, the menu) is a modal. With the details
  // column showing on a wide window, the column does the job instead.
  if (!inspect.big) {
    if (card.face === "face-down") return null;
    return <div aria-hidden="true" className={`pointer-events-none fixed right-3 top-14 z-[6400] w-64 ${settings.cardDetails ? "xl:hidden" : ""}`}><CardArt src={card.imageNormal ?? card.imageSmall} alt={card.name} label={card.name} className="shadow-2xl" /></div>;
  }
  return <div className="fixed inset-0 z-[6500] flex items-center justify-center bg-black/75 p-4" onClick={close}><div role="dialog" aria-label={`${card.name} details`} className="flex max-h-[90vh] max-w-3xl flex-col gap-4 overflow-auto rounded-xl border border-border-strong bg-surface-raised p-4 text-ink sm:flex-row" onClick={(e) => e.stopPropagation()}><div className="w-48 shrink-0 sm:w-64"><CardArt src={card.imageNormal ?? card.imageSmall} alt={card.name} label={card.name} faceDown={card.face === "face-down"} /></div><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><h2 className="text-lg font-semibold">{card.name}</h2><button onClick={close} aria-label="Close card details">✕</button></div><p className="text-sm text-ink-muted">{text?.manaCost} · {text?.typeLine ?? card.typeLine}</p><p className="mt-3 whitespace-pre-wrap text-sm">{text?.text ?? (fetched?.id === card.cardId ? fetched.text : null) ?? "No oracle text available."}</p><p className="mt-3 text-xs">{card.tapped ? "Tapped" : "Untapped"} · {card.face === "face-down" ? "Face down" : card.face}</p></div></div></div>;
}
