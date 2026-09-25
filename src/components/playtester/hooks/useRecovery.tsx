"use client";

import { useEffect, useState } from "react";
import { usePlayEnv } from "../context";
import { useExternal, usePlayStore } from "./useStore";
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
  // Publish the found game to the Start dialog, which shows the question (a
  // separate floating box could end up on the wrong screen, behind a dialog).
  useEffect(() => {
    env.ui.set((s) => ({ ...s, recovery: pending ? { age: pending.age, changed: pending.fingerprint !== env.fingerprint } : null }));
  }, [pending, env]);
  const choice = useExternal(env.ui, (s) => s.recoveryChoice);
  useEffect(() => {
    if (!choice) return;
    env.ui.set((s) => ({ ...s, recoveryChoice: null }));
    if (choice === "continue" && pending) {
      store.replace(pending.state, { session: pending.sessionId && pending.sessionUpdatedAt ? { id: pending.sessionId, title: "Recovered game", updatedAt: pending.sessionUpdatedAt } : null });
      env.ui.set((s) => ({ ...s, dialog: null }));
    }
    window.setTimeout(() => setPending(null), 0);
  }, [choice, pending, env, store]);
  // A new game started some other way: the question no longer applies.
  useEffect(() => store.subscribe(() => { if (store.get().game) setPending(null); }), [store]);
  return <>{notice ? <div role="status" className="absolute left-3 top-12 z-30 rounded bg-amber-900 p-2 text-xs">{notice}<button onClick={() => setNotice("")} className="ml-2 underline">Dismiss</button></div> : null}</>;
}
