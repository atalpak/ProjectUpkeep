"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui";
import { usePlayEnv } from "../context";
import { usePlayStore } from "./useStore";
import { agoText, buildEnvelope, foreignKeys, gameKey, indexKey, parseEnvelope, parseIndex, touchIndex } from "@/lib/playtest/recovery";
import type { ParsedEnvelope } from "@/lib/playtest/recovery";

/** Local saves are a crash cushion. Account saves use separate explicit actions. */
export function RecoveryManager() {
  const env = usePlayEnv(); const store = usePlayStore();
  const [pending, setPending] = useState<(Extract<ParsedEnvelope, { status: "ok" }> & { age: string }) | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let disabled = false; let timer = 0; let firstChange: number | null = null; let lastRevision = store.get().revision;
    const key = gameKey(env.userId, env.deckId);
    const fail = () => { disabled = true; env.recovery.set(() => ({ state: "off", savedAt: null })); };
    try {
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((x): x is string => x !== null);
      for (const foreign of foreignKeys(keys, env.userId)) localStorage.removeItem(foreign);
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = parseEnvelope(raw, env.deckId);
        if (parsed.status === "ok" && !store.get().game) window.setTimeout(() => setPending({ ...parsed, age: agoText(parsed.savedAt, Date.now()) }), 0);
        else if (parsed.status !== "ok") { localStorage.removeItem(key); window.setTimeout(() => setNotice("An unreadable local game was removed."), 0); }
      }
    } catch { fail(); }
    const write = () => {
      window.clearTimeout(timer); firstChange = null;
      if (disabled) return;
      const { game, session } = store.get(); if (!game) return;
      try {
        const now = Date.now(); localStorage.setItem(key, buildEnvelope(game, now, { sessionId: session?.id ?? null, sessionUpdatedAt: session?.updatedAt ?? null }));
        const result = touchIndex(parseIndex(localStorage.getItem(indexKey(env.userId))), env.deckId, now);
        localStorage.setItem(indexKey(env.userId), JSON.stringify(result.index));
        for (const deckId of result.evicted) localStorage.removeItem(gameKey(env.userId, deckId));
        env.recovery.set(() => ({ state: "saved", savedAt: now }));
      } catch { fail(); }
    };
    const unsub = store.subscribe(() => {
      const revision = store.get().revision; if (revision === lastRevision || disabled) return;
      lastRevision = revision; if (firstChange === null) firstChange = Date.now();
      window.clearTimeout(timer); timer = window.setTimeout(write, Math.min(1000, Math.max(0, 5000 - (Date.now() - firstChange))));
    });
    const visibility = () => { if (document.visibilityState === "hidden") write(); };
    window.addEventListener("pagehide", write); document.addEventListener("visibilitychange", visibility);
    return () => { unsub(); window.clearTimeout(timer); window.removeEventListener("pagehide", write); document.removeEventListener("visibilitychange", visibility); };
  }, [env, store]);
  return <>{notice ? <div role="status" className="absolute left-3 top-12 z-30 rounded bg-amber-900 p-2 text-xs">{notice}<button onClick={() => setNotice("")} className="ml-2 underline">Dismiss</button></div> : null}<Dialog open={pending !== null} onClose={() => setPending(null)} label="Restore local game" className="w-[min(90vw,32rem)] rounded-xl bg-surface p-5"><h2 className="text-lg font-semibold">Continue your game?</h2><p className="my-3">Continue your game from {pending ? pending.age : "earlier"}?</p>{pending?.fingerprint !== env.fingerprint ? <p className="mb-3 text-sm">The deck changed since this game started. The saved state keeps its original cards.</p> : null}<div className="flex gap-2"><button className="rounded bg-accent px-3 py-2 text-accent-ink" onClick={() => { if (pending) store.replace(pending.state, { session: pending.sessionId && pending.sessionUpdatedAt ? { id: pending.sessionId, title: "Recovered game", updatedAt: pending.sessionUpdatedAt } : null }); setPending(null); env.ui.set((s) => ({ ...s, dialog: null })); }}>Continue saved state</button><button className="rounded border border-border px-3 py-2" onClick={() => setPending(null)}>Start with current deck</button></div></Dialog></>;
}
