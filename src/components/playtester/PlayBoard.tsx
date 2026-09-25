"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Battlefield } from "@/components/playtester/Battlefield";
import { Hand } from "@/components/playtester/Hand";
import { PlayEnvProvider, usePlayEnv, type PlayActionsApi, type RecoveryStatus } from "@/components/playtester/context";
import { useExternal, usePlayStore, useSelector, PlayStoreProvider } from "@/components/playtester/hooks/useStore";
import { createExternalStore, createPlayStore } from "@/components/playtester/store";
import { createUiStore } from "@/components/playtester/ui-store";
import { buildCatalog } from "@/lib/playtest/catalog";
import { createGameStart } from "@/lib/playtest/game-start";
import { sortedHandOrder, randomIndex } from "@/lib/playtest/hand";
import { tidyLayout } from "@/lib/playtest/board/layout";
import { tryValidateSnapshot } from "@/lib/playtest/board/serialize";
import { DEFAULT_SETTINGS, sanitizeSettings } from "@/lib/playtest/settings";
import { prefsKey } from "@/lib/playtest/recovery";
import type { StartEntry } from "@/lib/playtest/slim";
import type { SavesSummary } from "@/lib/playtest/session";
import type { ZoneId, GameFormat } from "@/lib/playtest/board/types";
import type { GameCommand } from "@/lib/playtest/board/commands";

export type PlayBoardProps = {
  deckId: string; deckName: string; userId: string; fingerprint: string;
  entries: StartEntry[]; commanderCardId: string | null;
  saves: SavesSummary; initialSession: { id: string; title: string; updatedAt: string; snapshot: unknown } | null;
  actions: PlayActionsApi | null;
};

export function PlayBoard(props: PlayBoardProps) {
  const [store] = useState(() => createPlayStore());
  const [ui] = useState(createUiStore);
  const [settings] = useState(() => createExternalStore(DEFAULT_SETTINGS));
  const [recovery] = useState(() => createExternalStore<RecoveryStatus>({ state: "idle", savedAt: null }));
  const catalog = useMemo(() => buildCatalog(props.entries), [props.entries]);
  const perform = useCallback((id: string, arg?: number | string | null, mode?: "set" | "delta" | null) => {
    const game = store.get().game;
    const open = (dialog: Parameters<Parameters<typeof ui.set>[0]>[0]["dialog"]) => ui.set((s) => ({ ...s, dialog }));
    const dispatch = (command: GameCommand) => store.dispatch(command);
    const selected = store.get().selection;
    const move = (to: ZoneId, at: "top" | "bottom" = "top") => { if (selected.length) dispatch({ type: "MOVE_MANY", ids: [...selected], to, at }); };
    if (id === "undo") return store.undo();
    if (id === "redo") return store.redo();
    if (id === "new-game") return open("confirm-restart");
    if (id === "hand-hide") return ui.set((s) => ({ ...s, handHidden: !s.handHidden }));
    const dialogs: Record<string, Parameters<Parameters<typeof ui.set>[0]>[0]["dialog"]> = { "hand-overlay": "hand", save: "sessions", saves: "sessions", share: "share", settings: "settings", log: "log", metrics: "metrics", export: "export", keybinds: "shortcuts", palette: "palette", interaction: "interaction", roll: "dice-result", "create-token": "token" };
    if (id in dialogs) return open(dialogs[id]);
    if (!game) return;
    if (id === "draw" || id === "draw-n") return dispatch({ type: "DRAW", count: typeof arg === "number" ? arg : 1 });
    if (id === "mill") return dispatch({ type: "MILL", count: typeof arg === "number" ? arg : 1 });
    if (id === "shuffle") return dispatch({ type: "SHUFFLE", zone: "library", seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    if (id === "next-turn") return dispatch({ type: "NEXT_TURN" });
    if (id === "tidy") return dispatch(tidyLayout(game));
    if (id === "select-all") return store.setSelection(game.zones.battlefield);
    if (id === "clear-selection") return store.setSelection([]);
    if (id === "play-card" || id === "play-card-tapped") {
      if (typeof arg === "string") dispatch({ type: "MOVE_MANY", ids: [arg], to: "battlefield", at: "top", tapped: id === "play-card-tapped" });
      return;
    }
    if (id.startsWith("play-hand-")) {
      const tapped = id.startsWith("play-hand-tapped-");
      const index = Number(id.slice(-1)) - 1;
      const cardId = game.zones.hand[index];
      if (cardId) dispatch({ type: "MOVE_MANY", ids: [cardId], to: "battlefield", at: "top", tapped });
      return;
    }
    if (id === "to-graveyard") return move("graveyard");
    if (id === "to-exile") return move("exile");
    if (id === "to-hand") return move("hand");
    if (id === "to-library-top") return move("library", "top");
    if (id === "to-library-bottom") return move("library", "bottom");
    if (id === "tap-toggle" || id === "tap-all" || id === "untap-all") {
      const ids = id === "tap-toggle" ? selected : game.zones.battlefield;
      if (ids.length) dispatch({ type: "SET_CARD_FLAGS", ids: [...ids], flags: { tapped: id === "tap-toggle" ? !game.cards[ids[0]].tapped : id === "tap-all" } });
      return;
    }
    if (id === "hand-random-discard") { const i = randomIndex(game.zones.hand.length, Math.random); if (i >= 0) dispatch({ type: "RANDOM_DISCARD", cardId: game.zones.hand[i] }); return; }
    if (id.startsWith("hand-sort-")) { const key = id.slice(10) as "name" | "type" | "color" | "mv"; dispatch({ type: "REORDER_ZONE", zone: "hand", order: sortedHandOrder(game, key, (c) => catalog.get(c.cardId ?? "")?.colors ?? []) }); return; }
    if (id === "hand-all-to-graveyard" || id === "hand-all-to-library") { if (game.zones.hand.length) dispatch({ type: "MOVE_MANY", ids: [...game.zones.hand], to: id === "hand-all-to-library" ? "library" : "graveyard", at: "top" }); return; }
    if (id === "life-set" && typeof arg === "number") return dispatch(mode === "delta" ? { type: "SET_LIFE", delta: arg } : { type: "SET_TRACKER", path: "life", value: arg });
    if (id.startsWith("tracker-") && typeof arg === "number") return dispatch({ type: "SET_TRACKER", path: id.slice(8), value: arg });
    if (id === "set-turn" && typeof arg === "number") return dispatch({ type: "SET_TURN", turn: arg });
    if (id === "view-graveyard" || id === "view-exile" || id === "view-command" || id === "view-zones" || id === "search-library" || id === "peek-top" || id === "peek-bottom") {
      const zone: ZoneId = id === "view-exile" ? "exile" : id === "view-command" ? "command" : id === "view-graveyard" ? "graveyard" : id === "view-zones" ? "sideboard" : "library";
      ui.set((s) => ({ ...s, dialog: "zone", zone: { zone, mode: id.startsWith("peek") ? "peek" : id === "search-library" ? "search" : "browse", from: id === "peek-bottom" ? "bottom" : "top", count: typeof arg === "number" ? arg : 3 } }));
    }
  }, [store, ui, catalog]);
  const env = useMemo(() => ({ deckId: props.deckId, deckName: props.deckName, userId: props.userId, fingerprint: props.fingerprint, ui, settings, catalog, actions: props.actions, saves: props.saves, perform, recovery, origin: () => window.location.origin }), [props.deckId, props.deckName, props.userId, props.fingerprint, ui, settings, catalog, props.actions, props.saves, perform, recovery]);

  useEffect(() => {
    try { settings.set(() => sanitizeSettings(JSON.parse(localStorage.getItem(prefsKey(props.userId)) ?? "null"))); } catch { /* preferences are optional */ }
    const restored = props.initialSession ? tryValidateSnapshot(props.initialSession.snapshot) : null;
    if (restored && restored.deckId === props.deckId) store.replace(restored, { saved: true, session: { id: props.initialSession!.id, title: props.initialSession!.title, updatedAt: props.initialSession!.updatedAt } });
    else ui.set((s) => ({ ...s, dialog: "start" }));
  }, [props.deckId, props.initialSession, props.userId, settings, store, ui]);

  return <PlayStoreProvider value={store}><PlayEnvProvider value={env}><Table entries={props.entries} commanderCardId={props.commanderCardId} /></PlayEnvProvider></PlayStoreProvider>;
}

function Table({ entries, commanderCardId }: { entries: StartEntry[]; commanderCardId: string | null }) {
  const store = usePlayStore();
  const game = useSelector((s) => s.game);
  return <div className="playtester-table relative flex h-[calc(100dvh-5rem)] min-h-[36rem] flex-col overflow-hidden rounded-xl border border-white/15 bg-[#141310] text-white" style={{ fontFamily: "var(--font-sans), sans-serif" }}>
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs"><div className="flex gap-2"><TopButton label="Playtester actions" id="palette" /><TopButton label="Keybinds" id="keybinds" /></div><span className="truncate text-white/60">{game ? `Turn ${game.turn}` : "Ready to play"}</span><TopButton label="Full interaction log" id="log" /></div>
    <div className="min-h-0 flex-1 p-2"><Battlefield /></div>
    <div className="flex min-h-[12rem] gap-3 border-t border-white/10 bg-black/25 p-2"><Hand /><div className="flex w-48 shrink-0 gap-1 sm:w-64"><Pile zone="library" /><Pile zone="graveyard" /><Pile zone="exile" /></div></div>
    <div className="flex justify-end bg-black/25 px-2"><TopButton label="View other zones" id="view-zones" /></div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/15 bg-black/40 px-3 py-2"><div className="flex items-center gap-2"><TopButton label="Game" id="saves" />{game ? <><span className="text-sm">Life {game.trackers.life}</span><button onClick={() => store.dispatch({ type: "SET_LIFE", delta: -1 })} aria-label="Lose one life" className="px-2">−</button><button onClick={() => store.dispatch({ type: "SET_LIFE", delta: 1 })} aria-label="Gain one life" className="px-2">+</button><span className="text-xs text-white/70">Poison {game.trackers.poison} · Energy {game.trackers.energy} · Experience {game.trackers.experience}</span></> : null}</div><div className="flex gap-2"><TopButton label="Next turn" id="next-turn" /><TopButton label="More" id="palette" /></div></div>
    <TableDialogs entries={entries} commanderCardId={commanderCardId} />
  </div>;
}

function TopButton({ label, id }: { label: string; id: string }) { const { perform } = usePlayEnv(); return <button type="button" onClick={() => perform(id)} className="rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 coarse:min-h-11">{label}</button>; }
function Pile({ zone }: { zone: "library" | "graveyard" | "exile" }) { const { perform } = usePlayEnv(); const game = useSelector((s) => s.game); const count = game?.zones[zone].length ?? 0; return <button type="button" onClick={() => perform(zone === "library" ? "search-library" : `view-${zone}`)} className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg border border-white/20 bg-white/5 p-1 text-center text-xs hover:bg-white/10 coarse:min-h-11"><span className="font-semibold capitalize">{zone}</span><span>{count}</span><span className="text-white/50">{count ? "View cards" : "No cards"}</span></button>; }

function TableDialogs({ entries, commanderCardId }: { entries: StartEntry[]; commanderCardId: string | null }) {
  const store = usePlayStore(); const env = usePlayEnv(); const dialog = useExternal(env.ui, (s) => s.dialog); const [format, setFormat] = useState<GameFormat>(commanderCardId ? "commander" : "constructed");
  if (!dialog) return null;
  const close = () => env.ui.set((s) => ({ ...s, dialog: null }));
  const start = () => { store.replace(createGameStart({ deckId: env.deckId, fingerprint: env.fingerprint, entries, commanderCardIds: commanderCardId ? [commanderCardId] : [], format }, crypto.getRandomValues(new Uint32Array(1))[0])); close(); };
  return <div className="absolute inset-0 z-[5000] flex items-center justify-center bg-black/65 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && dialog !== "start") close(); }}><section role="dialog" aria-modal="true" aria-label={dialog} className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/20 bg-[#25231f] p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold capitalize">{dialog.replaceAll("-", " ")}</h2>{dialog !== "start" ? <button onClick={close} aria-label="Close" className="rounded px-2 py-1 hover:bg-white/10">✕</button> : null}</div>{dialog === "start" || dialog === "confirm-restart" ? <div className="space-y-4"><p>Shuffle and deal an opening hand from the current deck.</p><label className="block text-sm">Format <select value={format} onChange={(e) => setFormat(e.target.value as GameFormat)} className="ml-2 rounded bg-black/40 p-2"><option value="commander">Commander · 40 life</option><option value="constructed">Constructed · 20 life</option></select></label><button onClick={start} className="rounded bg-accent px-4 py-2 text-accent-ink">Start game</button></div> : <p className="text-sm text-white/70">Choose an action from the table controls.</p>}</section></div>;
}
