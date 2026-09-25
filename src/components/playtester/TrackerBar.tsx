"use client";

import { useEffect, useRef, useState } from "react";

import { usePlayEnv, useUi } from "./context";
import { useExternal, useGame, usePlayStore } from "./hooks/useStore";
import { MANA_KEYS } from "@/lib/playtest/board/types";

function Step({ label, value, path }: { label: string; value: number; path: string }) {
  const store = usePlayStore();
  const previous = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (previous.current === value) return;
    const direction = value > previous.current ? "up" : "down";
    previous.current = value;
    const show = window.setTimeout(() => setFlash(direction), 0);
    const hide = window.setTimeout(() => setFlash(null), 550);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, [value]);
  const set = (n: number) => store.dispatch({ type: "SET_TRACKER", path, value: n });
  return <div className={`flex items-center gap-0.5 rounded border border-white/15 px-1 text-sm ${label === "Life" && flash === "up" ? "bg-emerald-900 text-emerald-100" : label === "Life" && flash === "down" ? "bg-red-900 text-red-100" : "bg-white/5"}`}><button aria-label={`Decrease ${label}`} onClick={() => set(value - 1)} className="px-1 coarse:min-h-11">−</button><button onClick={() => { const n = prompt(`Set ${label}`, String(value)); if (n !== null && Number.isFinite(Number(n))) set(Number(n)); }} aria-label={`${label} ${value}, edit`} className="min-w-8 px-1 font-semibold coarse:min-h-11">{label} <span key={value} className="pt-pop inline-block">{value}</span></button><button aria-label={`Increase ${label}`} onClick={() => set(value + 1)} className="px-1 coarse:min-h-11">+</button></div>;
}
export function TrackerBar() {
  const game = useGame(); const env = usePlayEnv(); const store = usePlayStore();
  const status = useExternal(env.recovery, (s) => s); const ui = useUi((s) => s);
  return <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/15 bg-black/40 px-3 py-2">
    <div className="flex flex-wrap items-center gap-1"><button onClick={() => env.perform("saves")} className="rounded border border-white/20 px-2 py-1.5 text-sm coarse:min-h-11">Game</button>{game ? <><Step label="Life" value={game.trackers.life} path="life" /><Step label="Poison" value={game.trackers.poison} path="poison" /><Step label="XP" value={game.trackers.experience} path="experience" /><Step label="Energy" value={game.trackers.energy} path="energy" />{MANA_KEYS.map((key) => <Step key={key} label={key} value={game.trackers.manaPool[key]} path={`manaPool.${key}`} />)}<details className="relative text-sm"><summary className="cursor-pointer rounded border border-white/20 px-2 py-1.5 coarse:min-h-11">Other trackers</summary><div className="absolute bottom-full left-0 z-40 min-w-64 space-y-2 rounded-lg border border-white/20 bg-[#25231f] p-3 shadow-xl"><Step label="Life 2" value={game.trackers.life2} path="life2" /><Step label="Damage" value={game.trackers.genericDamage} path="genericDamage" />{Object.entries(game.trackers.commanderDamage).map(([name, value]) => <Step key={name} label={`Damage: ${name}`} value={value} path={`commanderDamage.${name}`} />)}<button type="button" className="rounded border border-white/20 px-2 py-1 coarse:min-h-11" onClick={() => { const name = prompt("Opposing commander name"); if (name?.trim()) store.dispatch({ type: "SET_TRACKER", path: `commanderDamage.${name.trim()}`, value: 1 }); }}>Add commander damage</button></div></details></> : null}</div>
    <div className="flex items-center gap-2"><span className="text-xs text-white/60" role="status">{status.state === "saved" ? "Saved locally" : status.state === "off" ? "Crash recovery is off in this browser — save to your account to keep this game." : ""}</span><button type="button" onClick={() => env.perform("next-turn")} disabled={!game || game.opening.status !== "kept"} className="rounded bg-accent px-3 py-2 font-semibold text-accent-ink disabled:opacity-50 coarse:min-h-11">Next turn</button><button type="button" onClick={() => env.perform("palette")} aria-expanded={ui.dialog === "palette"} className="rounded border border-white/20 px-3 py-2 coarse:min-h-11">More</button></div>
  </div>;
}
