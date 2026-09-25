"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Battlefield } from "@/components/playtester/Battlefield";
import { Hand } from "@/components/playtester/Hand";
import { OpeningHand } from "@/components/playtester/OpeningHand";
import { CardMenu } from "@/components/playtester/CardMenu";
import { ZoneBrowser } from "@/components/playtester/ZoneBrowser";
import { closeZoneOverlay, openDialog } from "@/components/playtester/zone-overlay";
import { AuxPanel } from "@/components/playtester/AuxPanels";
import { RecoveryManager } from "@/components/playtester/hooks/useRecovery";
import { TrackerBar } from "@/components/playtester/TrackerBar";
import { ExternalIcon, KebabIcon, QuestionIcon } from "@/components/playtester/icons";
import { OtherZonesTab, Piles } from "@/components/playtester/Piles";
import { CardInspector } from "@/components/playtester/CardInspector";
import { PopoutBridge } from "@/components/playtester/PopoutBridge";
import { focusedCardId } from "@/components/playtester/board-actions";
import { matchPalette, resolveShortcut, PALETTE_ACTIONS } from "@/lib/playtest/palette";
import { PlayEnvProvider, usePlayEnv, useSettings, type PlayActionsApi, type RecoveryStatus } from "@/components/playtester/context";
import { useExternal, usePlayStore, useSelector, PlayStoreProvider } from "@/components/playtester/hooks/useStore";
import { createExternalStore, createPlayStore } from "@/components/playtester/store";
import { createUiStore } from "@/components/playtester/ui-store";
import { buildCatalog } from "@/lib/playtest/catalog";
import { createGameStart } from "@/lib/playtest/game-start";
import { sortedHandOrder, randomIndex } from "@/lib/playtest/hand";
import { tidyLayout } from "@/lib/playtest/board/layout";
import { tryValidateSnapshot } from "@/lib/playtest/board/serialize";
import { DEFAULT_SETTINGS, PLAYMATS, SLEEVES, sanitizeSettings } from "@/lib/playtest/settings";
import { selectionTotals } from "@/lib/playtest/board/selectors";
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
  const handledSession = useRef<string | null>(null);
  const catalog = useMemo(() => buildCatalog(props.entries), [props.entries]);
  const perform = useCallback((id: string, arg?: number | string | null, mode?: "set" | "delta" | null) => {
    const game = store.get().game;
    const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
    const open = (dialog: Parameters<Parameters<typeof ui.set>[0]>[0]["dialog"]) => { if (dialog) openDialog(store, ui, settings, seed, dialog); };
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
    if (id === "next-turn") return game.simulator.settings.enabled || settings.get().upkeepReminder ? open("interaction") : dispatch({ type: "NEXT_TURN" });
    if (id === "tidy") return dispatch(tidyLayout(game));
    if (id === "inspect") { const cardId = focusedCardId(); if (cardId) ui.set((s) => ({ ...s, inspect: { cardId, big: true } })); return; }
    if (id === "select-all") return store.setSelection(game.zones.battlefield);
    if (id === "clear-selection") return store.setSelection([]);
    if (id === "group" && selected.length) {
      const label = prompt("Group name", "Group"); if (label === null) return;
      const arrangement = prompt("Arrangement: row, column or stack", "row");
      dispatch({ type: "SET_GROUP", ids: [...selected], groupId: crypto.randomUUID().slice(0, 40), group: { label, arrangement: arrangement === "column" || arrangement === "stack" ? arrangement : "row" } }); return;
    }
    if (id === "ungroup") return dispatch({ type: "SET_GROUP", ids: [...selected], groupId: null });
    if (id === "proliferate") return dispatch({ type: "PROLIFERATE", ids: [...selected] });
    if (id === "add-counter" || id === "remove-counter") {
      const name = typeof arg === "string" ? arg : id === "remove-counter" ? "+1/+1" : prompt("Counter name", "+1/+1");
      if (name && selected.length) dispatch({ type: "BATCH", commands: selected.map((cardId) => ({ type: "ADD_COUNTER", cardId, name, delta: id === "remove-counter" ? -1 : 1 })) });
      return;
    }
    if (id === "delete") { const ids = selected.filter((cardId) => game.cards[cardId]?.kind !== "deck-card"); if (ids.length) dispatch({ type: "BATCH", commands: ids.map((cardId) => ({ type: "DELETE_OBJECT", cardId })) }); return; }
    if (id === "copy-token" && selected.length) {
      const source = game.cards[selected[0]];
      dispatch({ type: "CREATE_EXTRA", ids: [crypto.randomUUID()], spec: { name: source.name, typeLine: source.typeLine, power: source.power, toughness: source.toughness, manaValue: source.manaValue, imageSmall: source.imageSmall, imageNormal: source.imageNormal, cardId: source.cardId, oracleId: source.oracleId }, kind: "copy", copiedFromId: source.id, zone: "battlefield" }); return;
    }
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
    if (id === "hand-all-to-graveyard" || id === "hand-all-to-library") { if (game.zones.hand.length) { const moveHand: GameCommand = { type: "MOVE_MANY", ids: [...game.zones.hand], to: id === "hand-all-to-library" ? "library" : "graveyard", at: "top" }; dispatch(id === "hand-all-to-library" ? { type: "BATCH", commands: [moveHand, { type: "SHUFFLE", zone: "library", seed: crypto.getRandomValues(new Uint32Array(1))[0] }] } : moveHand); } return; }
    if (id === "random-draw" && game.zones.library.length) return dispatch({ type: "MOVE_MANY", ids: [game.zones.library[randomIndex(game.zones.library.length, Math.random)]], to: "hand", at: "bottom" });
    if (id === "top-to-graveyard" && game.zones.library.length) return dispatch({ type: "MOVE_MANY", ids: [game.zones.library[0]], to: "graveyard", at: "top" });
    if (id === "life-set") { const n = typeof arg === "number" ? arg : Number(prompt("Set life", String(game.trackers.life))); if (Number.isFinite(n)) dispatch(mode === "delta" ? { type: "SET_LIFE", delta: n } : { type: "SET_TRACKER", path: "life", value: n }); return; }
    if (id.startsWith("tracker-")) { const path = id.slice(8); const n = typeof arg === "number" ? arg : Number(prompt(`Set ${path}`, String(game.trackers[path as "poison" | "energy" | "experience"]))); if (Number.isFinite(n)) dispatch({ type: "SET_TRACKER", path, value: n }); return; }
    if (id === "set-turn") { const n = typeof arg === "number" ? arg : Number(prompt("Set turn", String(game.turn))); if (Number.isFinite(n)) dispatch({ type: "SET_TURN", turn: n }); return; }
    if (id === "view-graveyard" || id === "view-exile" || id === "view-command" || id === "view-zones" || id === "search-library" || id === "peek-top" || id === "peek-bottom") {
      const zone: ZoneId = id === "view-exile" ? "exile" : id === "view-command" ? "command" : id === "view-graveyard" ? "graveyard" : id === "view-zones" ? "sideboard" : "library";
      openDialog(store, ui, settings, seed, "zone", { zone, mode: id.startsWith("peek") ? "peek" : id === "search-library" ? "search" : "browse", from: id === "peek-bottom" ? "bottom" : "top", count: typeof arg === "number" ? arg : 3 });
      if (id.startsWith("peek")) dispatch({ type: "PEEK", zone: "library", from: id === "peek-bottom" ? "bottom" : "top", count: typeof arg === "number" ? arg : 3 });
    }
  }, [store, ui, catalog, settings]);
  const env = useMemo(() => ({ deckId: props.deckId, deckName: props.deckName, userId: props.userId, fingerprint: props.fingerprint, ui, settings, catalog, actions: props.actions, saves: props.saves, perform, recovery, origin: () => window.location.origin }), [props.deckId, props.deckName, props.userId, props.fingerprint, ui, settings, catalog, props.actions, props.saves, perform, recovery]);

  useEffect(() => {
    if (props.initialSession && handledSession.current === props.initialSession.id) return;
    handledSession.current = props.initialSession?.id ?? null;
    try { settings.set(() => sanitizeSettings(JSON.parse(localStorage.getItem(prefsKey(props.userId)) ?? "null"))); } catch { /* preferences are optional */ }
    const restored = props.initialSession ? tryValidateSnapshot(props.initialSession.snapshot) : null;
    if (restored && restored.deckId === props.deckId) {
      const continueSaved = restored.source.fingerprint === props.fingerprint || window.confirm("This deck has changed since the game was saved. OK: Continue saved state. Cancel: Start with current deck.");
      if (continueSaved) store.replace(restored, { saved: true, session: { id: props.initialSession!.id, title: props.initialSession!.title, updatedAt: props.initialSession!.updatedAt } });
      else ui.set((s) => ({ ...s, dialog: "start" }));
    } else ui.set((s) => ({ ...s, dialog: "start" }));
  }, [props.deckId, props.fingerprint, props.initialSession, props.userId, settings, store, ui]);

  return <PlayStoreProvider value={store}><PlayEnvProvider value={env}><Table entries={props.entries} commanderCardId={props.commanderCardId} /></PlayEnvProvider></PlayStoreProvider>;
}

function Table({ entries, commanderCardId }: { entries: StartEntry[]; commanderCardId: string | null }) {
  const game = useSelector((s) => s.game);
  const selection = useSelector((s) => s.selection);
  const toast = useSelector((s) => s.toast);
  const store = usePlayStore();
  const env = usePlayEnv();
  const settings = useSettings();
  const dragging = useExternal(env.ui, (s) => s.dragging);
  const [banner, setBanner] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // The docked zone sheet must stop above the hand, piles and toolbar, whatever
  // height those come to (they scale with the viewport, and wrap at 200% zoom).
  useLayoutEffect(() => {
    const el = bottom.current; const host = root.current;
    if (!el || !host || typeof ResizeObserver === "undefined") return;
    const measure = () => host.style.setProperty("--pt-bottom", `${el.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const turn = game?.turn;
  useEffect(() => {
    if (turn === undefined || turn === 0) return;
    const show = window.setTimeout(() => setBanner(turn), 0);
    const hide = window.setTimeout(() => setBanner(null), 1700);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, [turn]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target;
      if (el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (env.ui.get().dialog || env.ui.get().menu) return;
      const id = resolveShortcut({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey });
      if (id) { event.preventDefault(); env.perform(id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [env]);
  const totals = game ? selectionTotals(game, selection) : null;
  return <div ref={root} data-still={settings.motion === "reduce" || undefined} data-dragging={dragging || undefined} className="dark group/table playtester-table pt-mat fixed inset-0 z-40 flex h-dvh flex-col overflow-y-auto text-ink" style={{ backgroundColor: PLAYMATS[settings.playmat].value, fontFamily: "var(--font-body), sans-serif", "--mat-tint": PLAYMATS[settings.playmat].value, "--sleeve": SLEEVES[settings.sleeve].value } as React.CSSProperties}>
    <div className="flex items-start justify-between gap-3 px-3 pt-3 text-sm max-[900px]:pt-2">
      <div className="flex flex-col items-start gap-0.5 [@media(max-height:600px)]:flex-row [@media(max-height:600px)]:gap-1"><TopText label="Playtester actions" id="palette" icon={<KebabIcon />} /><TopText label="Keybinds" id="keybinds" icon={<QuestionIcon />} /></div>
      <span className="mt-1.5 truncate text-xs text-ink-muted max-sm:hidden">{game ? `Turn ${game.turn}` : "Ready to play"}</span>
      <div className="flex flex-col items-end gap-1"><button type="button" aria-label="Full interaction log" onClick={() => env.perform("log")} className="flex items-center gap-2 rounded-lg bg-surface-raised px-4 py-2.5 text-sm font-semibold text-ink hover:brightness-125 coarse:min-h-11"><span className="max-sm:hidden">Full interaction log</span><span className="sm:hidden">Log</span> <ExternalIcon /></button><Link href={`/decks/${env.deckId}/play/popout`} target="_blank" className="rounded px-1 text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline">Pop out the table</Link></div>
    </div>
    <div className="flex min-h-24 flex-1 p-2"><Battlefield /></div>
    {banner !== null ? <div className="pt-banner pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-accent px-5 py-2 font-semibold text-accent-ink shadow-lg" role="status">Turn {banner}</div> : null}
    {totals && totals.count > 0 ? <div className="absolute left-3 top-[5.5rem] z-20 rounded-full bg-black/60 px-3 py-1 text-xs" role="status">{totals.count} selected · {totals.power}/{totals.toughness} total P/T</div> : null}
    {toast ? <div className="absolute bottom-56 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface-raised px-4 py-2 text-sm shadow-lg" role="status"><span>{toast.text}</span>{toast.undoable ? <button onClick={() => store.undo()} className="font-semibold text-accent underline">Undo</button> : null}<button onClick={() => store.dismissToast(toast.id)} aria-label="Dismiss notification">✕</button></div> : null}
    <div ref={bottom} className="flex shrink-0 flex-col"><div className="flex items-stretch gap-3 border-t border-border pl-3 max-sm:flex-col max-sm:gap-0 max-sm:pl-0"><Hand /><div className="flex items-stretch gap-3 max-sm:items-end max-sm:justify-between max-sm:gap-2 max-sm:px-3"><Piles /><OtherZonesTab /></div></div>
    <TrackerBar /></div>
    <RecoveryManager /><PopoutBridge /><OpeningHand /><TableDialogs entries={entries} commanderCardId={commanderCardId} /><CardMenu /><CardInspector />
  </div>;
}

function TopText({ label, id, icon }: { label: string; id: string; icon: React.ReactNode }) { const { perform } = usePlayEnv(); return <button type="button" onClick={() => perform(id)} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ink-muted hover:bg-white/10 hover:text-ink coarse:min-h-11">{icon}{label}</button>; }

function TableDialogs({ entries, commanderCardId }: { entries: StartEntry[]; commanderCardId: string | null }) {
  const store = usePlayStore();
  const env = usePlayEnv();
  const dialog = useExternal(env.ui, (s) => s.dialog);
  const keepOpen = useSettings().keepSearchOpenWhileDragging;
  // "Keep search open while dragging": the zone overlay becomes a docked side
  // sheet over the battlefield instead of a modal, so the table, the hand and
  // the piles stay reachable as drop targets while it is open.
  const docked = dialog === "zone" && keepOpen;
  const [format, setFormat] = useState<GameFormat>(commanderCardId ? "commander" : "constructed");
  const [life, setLife] = useState(commanderCardId ? 40 : 20);
  const [partnerId, setPartnerId] = useState("");
  const [freeMulligan, setFreeMulligan] = useState(false);
  const [firstTurnDraws, setFirstTurnDraws] = useState(false);
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!dialog) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    return () => opener.current?.focus();
  }, [dialog]);
  // Escape closes whatever dialog is open, wherever focus is: a resize, a
  // click on the backdrop or a menu closing can leave focus on the page, and a
  // handler that only listens inside the panel would then never hear it. The
  // opening-hand start dialog is the one that cannot be dismissed.
  useEffect(() => {
    if (!dialog || dialog === "start") return;
    const onKey = (event: KeyboardEvent) => {
      const ui = env.ui.get();
      if (event.key !== "Escape" || ui.menu || ui.dragging || !ui.dialog || ui.dialog === "start") return;
      event.preventDefault();
      if (ui.dialog === "zone") closeZoneOverlay(store, env.ui, env.settings, () => crypto.getRandomValues(new Uint32Array(1))[0]);
      else env.ui.set((s) => ({ ...s, dialog: null, zone: null }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, env, store]);
  if (!dialog) return null;
  const close = () => {
    if (env.ui.get().dialog !== dialog) return;
    // Every way of closing the zone overlay goes through one function, so the
    // shuffle-on-close choice is resolved exactly once (zone-overlay.ts).
    if (dialog === "zone") { closeZoneOverlay(store, env.ui, env.settings, () => crypto.getRandomValues(new Uint32Array(1))[0]); return; }
    env.ui.set((s) => ({ ...s, dialog: null, zone: null }));
  };
  const valid = entries.some((e) => e.quantity > 0 && e.cards !== null);
  const start = () => {
    if (!valid) return;
    const commanderCardIds = format === "commander" ? [commanderCardId, partnerId || null].filter((x): x is string => x !== null) : [];
    store.replace(createGameStart({ deckId: env.deckId, fingerprint: env.fingerprint, entries, commanderCardIds, format, startingLife: life, freeMulligan: freeMulligan ? "first" : "none", firstTurnDraws }, crypto.getRandomValues(new Uint32Array(1))[0]));
    close();
  };
  const matches = matchPalette(query, 30);
  return <div data-docked={docked || undefined} className={docked ? "pointer-events-none absolute inset-x-0 top-20 bottom-[var(--pt-bottom,17rem)] z-[5000] flex justify-end px-3" : "absolute inset-0 z-[5000] flex items-center justify-center bg-black/65 p-4"} onMouseDown={(e) => { if (!docked && e.target === e.currentTarget && dialog !== "start") close(); }}>
    <section ref={panel} role="dialog" aria-modal={docked ? "false" : "true"} aria-label={dialog} className={docked ? "pointer-events-auto flex h-full min-h-40 w-[min(24rem,92vw)] flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-raised p-4 shadow-[var(--shadow-raised)]" : "max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border-strong bg-surface-raised p-5 shadow-2xl"} onKeyDown={(e) => {
      if (e.key === "Escape" && dialog !== "start") { e.preventDefault(); close(); }
      if (e.key === "Tab" && !docked) {
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]") ?? []);
        const first = items[0]; const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold capitalize">{dialog.replaceAll("-", " ")}</h2>{dialog !== "start" ? <button onClick={close} aria-label="Close" className="rounded px-2 py-1 hover:bg-white/10">✕</button> : null}</div>
      {dialog === "start" || dialog === "confirm-restart" ? <div className="space-y-4 text-sm">
        <p>{dialog === "confirm-restart" ? "Start a new game? The current table will be replaced." : "Shuffle and deal an opening hand from the current deck."}</p>
        {!valid ? <p role="alert" className="text-amber-200">This deck has no usable cards. Add cards to its decklist before playing.</p> : null}
        <label className="block">Format <select value={format} onChange={(e) => { const next = e.target.value as GameFormat; setFormat(next); setLife(next === "commander" ? 40 : 20); }} className="ml-2 rounded bg-black/40 p-2"><option value="commander">Commander · 40 life</option><option value="constructed">Constructed · 20 life</option></select></label>
        <label className="block">Starting life <input type="number" min="1" max="999" value={life} onChange={(e) => setLife(Number(e.target.value))} className="ml-2 w-20 rounded bg-black/40 p-2" /></label>
        {format === "commander" ? <label className="block">Partner commander <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="ml-2 max-w-full rounded bg-black/40 p-2"><option value="">None</option>{entries.filter((e) => e.cards && e.card_id !== commanderCardId).map((e) => <option key={e.id} value={e.card_id}>{e.cards?.name}</option>)}</select></label> : null}
        <label className="block"><input type="checkbox" checked={freeMulligan} onChange={(e) => setFreeMulligan(e.target.checked)} /> First mulligan free</label>
        <label className="block"><input type="checkbox" checked={firstTurnDraws} onChange={(e) => setFirstTurnDraws(e.target.checked)} /> Draw on turn one</label>
        <button onClick={start} disabled={!valid || life < 1 || life > 999} className="rounded bg-accent px-4 py-2 text-accent-ink disabled:opacity-40 coarse:min-h-11">{dialog === "confirm-restart" ? "Restart game" : "Start game"}</button>
      </div> : dialog === "zone" ? <ZoneBrowser onClose={close} docked={docked} /> : dialog === "palette" ? <div>
        <input autoFocus aria-label="Search actions" placeholder="Type an action, like draw 3" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { env.perform(matches[0].id, matches[0].arg, matches[0].mode); close(); } }} className="mb-3 w-full rounded bg-black/40 p-2" />
        <div className="max-h-[50vh] overflow-auto">{matches.map((item, index) => <button key={`${item.id}:${index}`} type="button" onClick={() => { env.perform(item.id, item.arg, item.mode); close(); }} className="block w-full rounded p-2 text-left text-sm hover:bg-white/10 coarse:min-h-11">{item.label}</button>)}</div>
      </div> : dialog === "shortcuts" ? <div className="grid grid-cols-2 gap-2">{PALETTE_ACTIONS.filter((a) => a.shortcut).map((a) => <div key={a.id} className="flex justify-between gap-2 text-sm"><span>{a.label}</span><kbd className="text-white/60">{a.shortcut}</kbd></div>)}</div> : <AuxPanel dialog={dialog} close={close} />}
    </section>
  </div>;
}
