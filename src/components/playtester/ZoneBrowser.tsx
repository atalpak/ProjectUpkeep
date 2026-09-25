"use client";

import { useState } from "react";
import { usePlayEnv, useUi } from "./context";
import { CardArt } from "./CardArt";
import { useGame } from "./hooks/useStore";
import { ZONE_IDS, ZONE_LABELS, type ZoneId } from "@/lib/playtest/board/types";

export function ZoneBrowser({ onClose }: { onClose: () => void }) {
  const game = useGame(); const env = usePlayEnv(); const request = useUi((s) => s.zone);
  const [filter, setFilter] = useState(""); const [zoneOverride, setZoneOverride] = useState<ZoneId | null>(null);
  if (!game || !request) return null;
  const zone = zoneOverride ?? request.zone;
  const ids = request.mode === "peek" && zone === "library" ? (request.from === "bottom" ? game.zones.library.slice(-Math.max(1, request.count ?? 3)) : game.zones.library.slice(0, Math.max(1, request.count ?? 3))) : game.zones[zone];
  const shown = ids.filter((id) => game.cards[id].name.toLowerCase().includes(filter.toLowerCase()));
  const close = () => onClose();
  return <div className="space-y-3"><div className="flex gap-2"><select aria-label="Zone" value={zone} onChange={(e) => setZoneOverride(e.target.value as ZoneId)} className="rounded bg-black/40 p-2">{ZONE_IDS.map((z) => <option key={z} value={z}>{ZONE_LABELS[z]} ({game.zones[z].length})</option>)}</select><input aria-label="Search zone" placeholder="Search cards" value={filter} onChange={(e) => setFilter(e.target.value)} className="min-w-0 flex-1 rounded bg-black/40 p-2" /></div><div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-auto sm:grid-cols-4">{shown.map((id) => { const card = game.cards[id]; return <button key={id} type="button" onClick={(e) => { const box = e.currentTarget.getBoundingClientRect(); env.ui.set((s) => ({ ...s, menu: { cardId: id, x: box.left, y: box.bottom, opener: e.currentTarget } })); }} className="rounded p-1 text-left hover:bg-white/10 coarse:min-h-11"><CardArt src={card.imageSmall} alt={card.name} label={card.name} /><span className="block truncate text-xs">{card.name}</span></button>; })}</div>{shown.length === 0 ? <p className="text-white/60">No cards</p> : null}<button type="button" onClick={close} className="rounded bg-accent px-4 py-2 text-accent-ink coarse:min-h-11">Done{zone === "library" && request.mode === "search" && env.settings.get().shuffleOnClose ? " · shuffle library" : ""}</button></div>;
}
