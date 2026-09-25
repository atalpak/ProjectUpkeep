"use client";

import { useEffect, useState } from "react";
import { PublicBoard } from "./PublicBoard";
import { usePlayEnv } from "./context";
import { usePlayStore } from "./hooks/useStore";
import { projectPublic, readProjection, type PublicProjection } from "@/lib/playtest/board/share";

export const popoutChannel = (userId: string, deckId: string) => `upkeep:playtest:popout:${userId}:${deckId}`;

export function PopoutBridge() {
  const env = usePlayEnv(); const store = usePlayStore();
  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(popoutChannel(env.userId, env.deckId));
    const send = () => { const game = store.get().game; if (game) channel.postMessage(projectPublic(game, { showHand: false })); };
    channel.onmessage = (event) => { if (event.data === "ready") send(); };
    const unsub = store.subscribe(send); send();
    return () => { unsub(); channel.close(); };
  }, [env, store]);
  return null;
}

export function PopoutBoard({ deckId, userId }: { deckId: string; userId: string }) {
  const [projection, setProjection] = useState<PublicProjection | null>(null);
  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(popoutChannel(userId, deckId));
    channel.onmessage = (event) => { const validated = readProjection(event.data); if (validated) setProjection(validated); };
    channel.postMessage("ready");
    return () => channel.close();
  }, [deckId, userId]);
  return projection ? <PublicBoard title="Live playtest table" projection={projection} /> : <main className="p-8"><h1>Waiting for the playtest table</h1><p>Keep the owner table open in another tab in this browser.</p></main>;
}
