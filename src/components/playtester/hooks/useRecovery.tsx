"use client";

import { useEffect, useState } from "react";
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
  return <>{notice ? <div role="status" className="absolute left-3 top-12 z-30 rounded bg-amber-900 p-2 text-xs">{notice}<button onClick={() => setNotice("")} className="ml-2 underline">Dismiss</button></div> : null}{pending !== null ? <div role="alertdialog" aria-label="Continue your last game" className="pointer-events-auto absolute left-1/2 z-[5100] w-[min(92vw,22rem)] -translate-x-1/2 rounded-lg border border-border-strong bg-surface-raised p-3 text-sm shadow-[var(--shadow-raised)]" style={{ bottom: "calc(50% + 12rem)" }}><p className="font-medium">Continue your last game?</p><p className="mt-0.5 text-xs text-ink-muted">From {pending.age}.{pending.fingerprint !== env.fingerprint ? " The deck has changed since; the saved game keeps its original cards." : ""}</p><div className="mt-2 flex gap-2"><button autoFocus className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink coarse:min-h-11" onClick={() => { store.replace(pending.state, { session: pending.sessionId && pending.sessionUpdatedAt ? { id: pending.sessionId, title: "Recovered game", updatedAt: pending.sessionUpdatedAt } : null }); setPending(null); env.ui.set((s) => ({ ...s, dialog: null })); }}>Continue</button><button className="rounded border border-border px-3 py-1.5 text-xs coarse:min-h-11" onClick={() => setPending(null)}>Start fresh</button></div></div> : null}</>;
}
