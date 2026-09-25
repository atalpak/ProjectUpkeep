"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlayEnv } from "./context";
import { CardArt } from "./CardArt";
import { useGame, usePlayStore } from "./hooks/useStore";
import { compactLog, fullLogJson } from "@/lib/playtest/board/export";
import { describeEvent } from "@/lib/playtest/board/events";
import { computeMetrics, CONVENTIONS, logWarnings, type MvFilter } from "@/lib/playtest/board/metrics";
import { PLAYMATS, SLEEVES, type Settings } from "@/lib/playtest/settings";
import { prefsKey } from "@/lib/playtest/recovery";
import { rollResult } from "@/lib/playtest/dice";
import { mulberry32 } from "@/lib/playtest/rng";
import { generateInteraction } from "@/lib/playtest/opponent/generate";
import { PRESETS, applyPreset, CATEGORY_LABELS, PROMPT_TEXT } from "@/lib/playtest/opponent/presets";
import { previewLine, type SessionSummary, type ShareSummary } from "@/lib/playtest/session";
import type { DiceKind } from "@/lib/playtest/board/commands";
import { INTERACTION_CATEGORIES, type ChanceLevel } from "@/lib/playtest/board/types";

const Button = ({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) => <button type="button" disabled={disabled} onClick={onClick} className="rounded border border-white/25 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40 coarse:min-h-11">{children}</button>;
const Field = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => <label className="block text-sm">{label}<input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded bg-black/40 p-2" /></label>;

const SETTING_LABELS = {
  autoSize: "Squeeze the hand to fit",
  handHover: "Lift and preview hand cards on hover",
  showLabels: "Show card names on the table",
  countersOnTop: "Show counters on top of cards",
  shuffleOnClose: "Shuffle the library when a search closes",
  keepSearchOpenWhileDragging: "Keep the search open while dragging cards out",
  showInteractionLog: "Show the interaction log",
  upkeepReminder: "Remind me of upkeep before the draw",
  cardDetails: "Show the card details column (wide windows)",
} as const;

import { OtherZonesPanel } from "./OtherZones";

export function AuxPanel({ dialog, close }: { dialog: string; close: () => void }) {
  switch (dialog) {
    case "sessions": return <SessionsPanel close={close} />;
    case "share": return <SharePanel />;
    case "settings": return <SettingsPanel />;
    case "log": return <LogPanel />;
    case "metrics": return <MetricsPanel />;
    case "export": return <ExportPanel />;
    case "dice-result": return <DicePanel />;
    case "token": return <TokenPanel close={close} />;
    case "interaction": return <InteractionPanel close={close} />;
    case "hand": return <FullHand />;
    case "zones": return <OtherZonesPanel />;
    default: return <p className="text-sm text-white/70">Choose an action from the table controls.</p>;
  }
}

function SessionsPanel({ close }: { close: () => void }) {
  const env = usePlayEnv(); const store = usePlayStore(); const game = useGame(); const router = useRouter();
  const [sessions, setSessions] = useState(env.saves.sessions); const [title, setTitle] = useState(`${env.deckName} · turn ${game?.turn ?? 0}`); const [message, setMessage] = useState("");
  const linked = store.get().session;
  const report = (result: { ok: boolean; message?: string }) => setMessage(result.ok ? "Saved to your account." : result.message ?? "Could not save.");
  const save = async () => { if (!game || !env.actions) return; const result = await env.actions.saveSession({ title, snapshot: game }); report(result); if (result.ok) { setSessions((s) => [result.session, ...s]); store.markSaved({ id: result.session.id, title: result.session.title, updatedAt: result.session.updatedAt }); } };
  const overwrite = async () => { if (!game || !env.actions || !linked) return; const result = await env.actions.overwriteSession({ id: linked.id, expectedUpdatedAt: linked.updatedAt, snapshot: game }); report(result); if (result.ok) { setSessions((s) => s.map((x) => x.id === result.session.id ? result.session : x)); store.markSaved({ id: result.session.id, title: result.session.title, updatedAt: result.session.updatedAt }); } };
  const rename = async (s: SessionSummary) => { const value = prompt("Rename saved game", s.title); if (!value || !env.actions) return; const result = await env.actions.renameSession({ id: s.id, title: value }); report(result); if (result.ok) setSessions((list) => list.map((x) => x.id === s.id ? result.session : x)); };
  const duplicate = async (s: SessionSummary) => { if (!env.actions) return; const result = await env.actions.duplicateSession({ id: s.id }); report(result); if (result.ok) setSessions((list) => [result.session, ...list]); };
  const remove = async (s: SessionSummary) => { if (!env.actions || !confirm(`Delete ${s.title}?`)) return; const result = await env.actions.deleteSession({ id: s.id }); report(result); if (result.ok) setSessions((list) => list.filter((x) => x.id !== s.id)); };
  return <div className="space-y-3">{!env.saves.available || !env.actions ? <p>Account saving is unavailable right now. Local crash recovery may still work.</p> : <><Field label="Save as" value={title} onChange={setTitle} /><div className="flex flex-wrap gap-2"><Button onClick={save} disabled={!game}>Save as new</Button><Button onClick={overwrite} disabled={!game || !linked}>Overwrite linked save</Button></div></>}{message ? <p role="status" className="text-sm">{message}</p> : null}<h3 className="font-semibold">Saved games</h3><div className="max-h-64 space-y-2 overflow-auto">{sessions.map((s) => <div key={s.id} className="rounded border border-white/15 p-2 text-sm"><p className="font-medium">{s.title}</p><p className="text-white/60">{previewLine(s.preview)}</p>{s.sourceFingerprint !== env.fingerprint ? <p className="text-amber-200">Saved with a different deck list. Continue saved state or start with the current deck.</p> : null}<div className="mt-2 flex flex-wrap gap-1"><Button onClick={() => { if (store.get().game && store.get().revision !== store.get().savedRevision && !confirm("Leave the current unsaved game?")) return; close(); router.push(`/decks/${env.deckId}/play?session=${s.id}`); }}>Continue saved state</Button><Button onClick={() => { close(); router.push(`/decks/${env.deckId}/play`); }}>Start with current deck</Button><Button onClick={() => rename(s)}>Rename</Button><Button onClick={() => duplicate(s)}>Duplicate</Button><Button onClick={() => remove(s)}>Delete</Button></div></div>)}</div></div>;
}

function SharePanel() {
  const env = usePlayEnv(); const game = useGame(); const [shares, setShares] = useState(env.saves.shares); const [showHand, setShowHand] = useState(false); const [message, setMessage] = useState("");
  const link = (s: ShareSummary) => `${env.origin()}/shared/playtest/${s.token}`;
  const create = async () => { if (!game || !env.actions) return; const result = await env.actions.createShare({ snapshot: game, showHand, title: env.deckName }); if (result.ok) { setShares((list) => [result.share, ...list]); setMessage("Share link created for signed-in readers who have it."); } else setMessage(result.message); };
  const refresh = async (s: ShareSummary) => { if (!game || !env.actions) return; const result = await env.actions.refreshShare({ id: s.id, snapshot: game, showHand }); if (result.ok) { setShares((list) => list.map((x) => x.id === s.id ? result.share : x)); setMessage("Shared table updated."); } else setMessage(result.message); };
  const remove = async (s: ShareSummary) => { if (!env.actions) return; const result = await env.actions.deleteShare({ id: s.id }); if (result.ok) { setShares((list) => list.filter((x) => x.id !== s.id)); setMessage("Sharing stopped."); } else setMessage(result.message); };
  return <div className="space-y-3 text-sm"><p>Anyone signed in to Project Upkeep with the link can view a redacted table. The library order and private notes are never included.</p><label className="block"><input type="checkbox" checked={showHand} onChange={(e) => setShowHand(e.target.checked)} /> Show my hand in this share</label><Button onClick={create} disabled={!game || !env.actions}>Create link</Button>{message ? <p role="status">{message}</p> : null}{shares.map((s) => <div key={s.id} className="rounded border border-white/20 p-2"><p>{s.title} · expires {new Date(s.expiresAt).toLocaleDateString()}</p><p className="break-all text-white/70">{link(s)}</p><div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => navigator.clipboard.writeText(link(s))}>Copy link</Button><Button onClick={() => refresh(s)}>Update table</Button><Button onClick={() => remove(s)}>Stop sharing</Button><Link className="rounded border border-white/25 px-3 py-2" href={link(s)} target="_blank">Open</Link></div></div>)}</div>;
}

function SettingsPanel() {
  const env = usePlayEnv(); const game = useGame(); const store = usePlayStore(); const [settings, setSettings] = useState(env.settings.get());
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => { const next = { ...settings, [key]: value }; setSettings(next); env.settings.set(() => next); try { localStorage.setItem(prefsKey(env.userId), JSON.stringify(next)); } catch { /* preference storage is optional */ } };
  return <div className="space-y-4 text-sm"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label>Table card size<select value={settings.cardSize} onChange={(e) => update("cardSize", e.target.value as Settings["cardSize"])} className="mt-1 block w-full rounded bg-black/40 p-2">{["small", "medium", "large"].map((x) => <option key={x}>{x}</option>)}</select></label><label>Hand size<select value={settings.handSize} onChange={(e) => update("handSize", e.target.value as Settings["handSize"])} className="mt-1 block w-full rounded bg-black/40 p-2">{["small", "medium", "large"].map((x) => <option key={x}>{x}</option>)}</select></label><label>Playmat<select value={settings.playmat} onChange={(e) => update("playmat", e.target.value as Settings["playmat"])} className="mt-1 block w-full rounded bg-black/40 p-2">{Object.entries(PLAYMATS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><label>Sleeve<select value={settings.sleeve} onChange={(e) => update("sleeve", e.target.value as Settings["sleeve"])} className="mt-1 block w-full rounded bg-black/40 p-2">{Object.entries(SLEEVES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>{(["autoSize", "handHover", "showLabels", "countersOnTop", "shuffleOnClose", "keepSearchOpenWhileDragging", "showInteractionLog", "upkeepReminder", "cardDetails"] as const).map((key) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={settings[key]} onChange={(e) => update(key, e.target.checked)} />{SETTING_LABELS[key]}</label>)}<label>Hand click <select value={settings.handClick} onChange={(e) => update("handClick", e.target.value as Settings["handClick"])} className="rounded bg-black/40 p-2"><option value="menu">Open menu</option><option value="play">Play card</option></select></label><label>Visible hand cards <input type="number" min="4" max="40" value={settings.maxVisibleHand} onChange={(e) => update("maxVisibleHand", Number(e.target.value))} className="w-20 rounded bg-black/40 p-2" /></label><label>Motion <select value={settings.motion} onChange={(e) => update("motion", e.target.value as Settings["motion"])} className="rounded bg-black/40 p-2"><option value="system">System preference</option><option value="reduce">Reduce motion</option></select></label></div>{game ? <section className="border-t border-white/15 pt-3"><h3 className="font-semibold">Opponent prompts</h3><p className="text-white/60">Project Upkeep odds; prompts never move cards for you.</p><label className="block"><input type="checkbox" checked={game.simulator.settings.enabled} onChange={(e) => store.dispatch({ type: "SET_SIMULATOR", settings: { ...game.simulator.settings, enabled: e.target.checked } })} /> Enable prompts before each turn</label><label className="block">Preset <select value={game.simulator.settings.preset} onChange={(e) => store.dispatch({ type: "SET_SIMULATOR", settings: applyPreset(game.simulator.settings, e.target.value) })} className="rounded bg-black/40 p-2"><option value="custom">Custom</option>{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label className="block">First turn <input type="number" min="1" max="999" value={game.simulator.settings.firstTurn} onChange={(e) => store.dispatch({ type: "SET_SIMULATOR", settings: { ...game.simulator.settings, firstTurn: Number(e.target.value) } })} className="w-20 rounded bg-black/40 p-2" /></label><label className="block">Maximum prompts <select value={game.simulator.settings.maxPerTurn} onChange={(e) => store.dispatch({ type: "SET_SIMULATOR", settings: { ...game.simulator.settings, maxPerTurn: Number(e.target.value) } })} className="rounded bg-black/40 p-2"><option>1</option><option>2</option><option>3</option></select></label>{INTERACTION_CATEGORIES.map((category) => <label key={category} className="block">{CATEGORY_LABELS[category]} <select value={game.simulator.settings.chances[category]} onChange={(e) => store.dispatch({ type: "SET_SIMULATOR", settings: { ...game.simulator.settings, chances: { ...game.simulator.settings.chances, [category]: e.target.value as ChanceLevel }, preset: "custom" } })} className="rounded bg-black/40 p-2">{["off", "low", "medium", "high"].map((v) => <option key={v}>{v}</option>)}</select></label>)}<label className="block">No interaction chance <select value={game.simulator.settings.nothing} onChange={(e) => store.dispatch({ type: "SET_SIMULATOR", settings: { ...game.simulator.settings, nothing: e.target.value as ChanceLevel, preset: "custom" } })} className="rounded bg-black/40 p-2">{["off", "low", "medium", "high"].map((v) => <option key={v}>{v}</option>)}</select></label><label className="block"><input type="checkbox" checked={game.simulator.settings.millOpponent} onChange={(e) => store.dispatch({ type: "SET_SIMULATOR", settings: { ...game.simulator.settings, millOpponent: e.target.checked } })} /> Optional mill pressure</label><label className="block"><input type="checkbox" checked={game.simulator.settings.gameChangers} onChange={(e) => store.dispatch({ type: "SET_SIMULATOR", settings: { ...game.simulator.settings, gameChangers: e.target.checked } })} /> Game changer pressure</label></section> : null}</div>;
}

function LogPanel() { const game = useGame(); const store = usePlayStore(); if (!game) return null; return <div className="max-h-[60vh] space-y-1 overflow-auto text-sm">{logWarnings(game).map((w) => <p key={w} className="text-amber-200">{w}</p>)}{game.events.map((e, i) => { const heading = i === 0 || e.turn !== game.events[i - 1].turn; return <div key={e.seq}>{heading ? <h3 className="mt-3 font-semibold">{e.turn === 0 ? "Opening hand" : `Turn ${e.turn}`}</h3> : null}<div className="flex justify-between gap-2"><span className={e.voided ? "text-white/40 line-through" : ""}>{describeEvent(e)}</span><button type="button" onClick={() => store.dispatch({ type: "VOID_EVENT", seq: e.seq, voided: !e.voided })} className="text-accent underline">{e.voided ? "Restore" : "Void"}</button></div></div>; })}</div>; }
function MetricsPanel() {
  const game = useGame(); const [filter, setFilter] = useState<MvFilter>("all");
  if (!game) return null;
  const metrics = computeMetrics(game.events, game.eventsTruncatedBefore);
  const series = [
    { label: "Drawn", key: "drawn", color: "#d6ad5d", value: (turn: typeof metrics.turns[number]) => turn.drawn },
    { label: "Milled", key: "milled", color: "#91a8c9", value: (turn: typeof metrics.turns[number]) => turn.milled },
    { label: "Played mana value", key: "mv", color: "#ba9686", value: (turn: typeof metrics.turns[number]) => turn.playedMv[filter] },
    { label: "Mana producers", key: "producers", color: "#8eaf8c", value: (turn: typeof metrics.turns[number]) => turn.producers ?? 0 },
    { label: "Power in play", key: "power", color: "#c4a4c9", value: (turn: typeof metrics.turns[number]) => turn.power ?? 0 },
  ];
  return <div className="space-y-3 text-sm"><label>Played mana value filter <select value={filter} onChange={(e) => setFilter(e.target.value as MvFilter)} className="rounded bg-black/40 p-2"><option value="all">All cards</option><option value="creature">Creatures</option><option value="other">Other cards</option></select></label>{series.map((metric) => { const max = Math.max(1, ...metrics.turns.map(metric.value)); return <section key={metric.key} className="rounded border border-white/15 p-2"><h3 className="font-semibold">{metric.label}</h3>{metrics.turns.map((row) => <div key={row.turn} className="my-1 grid grid-cols-[4rem_1fr_2rem] items-center gap-2"><span>Turn {row.turn}</span><svg width="100%" height="12" role="img" aria-label={`${metric.value(row)} ${metric.label.toLowerCase()} on turn ${row.turn}`}><rect width={`${metric.value(row) / max * 100}%`} height="12" fill={metric.color} /></svg><span>{metric.value(row)}</span></div>)}</section>; })}{metrics.partial ? <p className="text-amber-200">Earlier events were trimmed; these charts are partial.</p> : null}{Object.values(CONVENTIONS).map((text) => <p key={text} className="text-white/60">{text}</p>)}</div>;
}
function ExportPanel() { const game = useGame(); const [audience, setAudience] = useState<"private" | "shareable">("shareable"); const [full, setFull] = useState(false); if (!game) return null; const content = full ? JSON.stringify(fullLogJson(game, audience), null, 2) : compactLog(game, audience); return <div className="space-y-3"><div className="flex gap-2"><label>Audience <select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} className="rounded bg-black/40 p-2"><option value="shareable">Shareable · redacted</option><option value="private">Private · full</option></select></label><label>Format <select value={full ? "json" : "text"} onChange={(e) => setFull(e.target.value === "json")} className="rounded bg-black/40 p-2"><option value="text">Text</option><option value="json">JSON</option></select></label></div><textarea readOnly value={content} className="h-48 w-full rounded bg-black/40 p-2 text-xs" /><div className="flex gap-2"><Button onClick={() => navigator.clipboard.writeText(content)}>Copy</Button><Button onClick={() => { const url = URL.createObjectURL(new Blob([content], { type: full ? "application/json" : "text/plain" })); const a = document.createElement("a"); a.href = url; a.download = `playtest-log.${full ? "json" : "txt"}`; a.click(); URL.revokeObjectURL(url); }}>Download</Button></div></div>; }
function DicePanel() { const store = usePlayStore(); const [result, setResult] = useState(""); const roll = (kind: DiceKind) => { const value = rollResult(kind, mulberry32(crypto.getRandomValues(new Uint32Array(1))[0])); store.dispatch({ type: "ROLL", kind, result: value }); setResult(kind === "coin" ? value ? "Heads" : "Tails" : `${kind}: ${value}`); }; return <div className="space-y-3"><div className="flex flex-wrap gap-2">{(["coin", "d4", "d6", "d8", "d10", "d12", "d20"] as DiceKind[]).map((kind) => <Button key={kind} onClick={() => roll(kind)}>{kind}</Button>)}</div><p role="status" className="text-2xl">{result}</p></div>; }
type TokenHit = { name: string; sample_card_id: string | null; sample_image_uri: string | null };
function TokenPanel({ close }: { close: () => void }) {
  const store = usePlayStore();
  const [name, setName] = useState("Token"); const [typeLine, setTypeLine] = useState("Creature — Token");
  const [power, setPower] = useState("1"); const [toughness, setToughness] = useState("1"); const [count, setCount] = useState(1);
  const [kind, setKind] = useState<"token" | "extra">("token");
  const [query, setQuery] = useState(""); const [hits, setHits] = useState<TokenHit[]>([]); const [message, setMessage] = useState("");
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/cards/search?type=Token&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.ok ? r.json() : null).then((data) => { if (data?.results) setHits(data.results); else setMessage("Catalog search is unavailable. Custom tokens still work."); }).catch(() => {});
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  const ids = () => Array.from({ length: Math.max(1, Math.min(100, count)) }, () => crypto.randomUUID());
  const fromCatalog = async (hit: TokenHit) => {
    if (!hit.sample_card_id) return;
    const response = await fetch(`/api/cards/${encodeURIComponent(hit.sample_card_id)}`);
    if (!response.ok) { setMessage("Could not load this printing."); return; }
    const data = await response.json(); const card = data.card;
    store.dispatch({ type: "CREATE_EXTRA", ids: ids(), spec: { name: card.name, typeLine: card.type_line, power: card.power, toughness: card.toughness, manaValue: card.cmc, cardId: card.scryfall_id, oracleId: card.oracle_id, imageSmall: card.image_uri_small, imageNormal: card.image_uri }, kind: "token", zone: "battlefield" });
    close();
  };
  return <div className="space-y-3"><Field label="Search official tokens" value={query} onChange={setQuery} />{hits.length ? <div className="max-h-36 overflow-auto">{hits.map((hit) => <button key={hit.sample_card_id ?? hit.name} type="button" onClick={() => fromCatalog(hit)} className="block w-full rounded px-2 py-1 text-left hover:bg-white/10 coarse:min-h-11">{hit.name}</button>)}</div> : null}{message ? <p role="status">{message}</p> : null}<p className="border-t border-white/15 pt-2 text-sm">Or make a custom game object:</p><label>Kind <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="rounded bg-black/40 p-2"><option value="token">Token</option><option value="extra">Extra card</option></select></label><Field label="Name" value={name} onChange={setName} /><Field label="Type" value={typeLine} onChange={setTypeLine} /><div className="flex gap-2"><Field label="Power" value={power} onChange={setPower} /><Field label="Toughness" value={toughness} onChange={setToughness} /><label>Count<input type="number" min="1" max="100" value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1 w-20 rounded bg-black/40 p-2" /></label></div><Button onClick={() => { if (!name.trim()) return; store.dispatch({ type: "CREATE_EXTRA", ids: ids(), spec: { name, typeLine, power, toughness, imageSmall: null, imageNormal: null }, kind, zone: "battlefield" }); close(); }}>Create {kind}</Button></div>;
}
function InteractionPanel({ close }: { close: () => void }) { const game = useGame(); const store = usePlayStore(); const [reroll, setReroll] = useState(0); if (!game) return null; const generated = generateInteraction(game.simulator.settings, game.simulator.seed, game.turn + 1, reroll); const finish = (resolution: "ignored" | "resolved") => { store.dispatch({ type: "RECORD_INTERACTION", turn: game.turn + 1, rerollIndex: reroll, prompts: generated.prompts, resolution }); store.dispatch({ type: "NEXT_TURN" }); close(); }; return <div className="space-y-3"><p>Upkeep reminder: resolve triggers manually. These are prompts only; they never move cards.</p><ul>{generated.prompts.length ? generated.prompts.map((prompt) => <li key={prompt}>{PROMPT_TEXT[prompt]}</li>) : <li>No interaction</li>}</ul><div className="flex gap-2"><Button onClick={() => finish("ignored")}>Ignore and advance</Button><Button onClick={() => finish("resolved")}>Resolved manually</Button><Button onClick={() => { store.dispatch({ type: "RECORD_INTERACTION", turn: game.turn + 1, rerollIndex: reroll, prompts: generated.prompts, resolution: "rerolled", reason: "Player requested a new prompt" }); setReroll((n) => n + 1); }}>Reroll</Button></div></div>; }
function FullHand() { const game = useGame(); const store = usePlayStore(); const env = usePlayEnv(); if (!game) return null; return <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-auto sm:grid-cols-4">{game.zones.hand.map((id) => <div key={id} className="rounded border border-white/15 p-2"><CardArt src={game.cards[id].imageSmall} alt={game.cards[id].name} label={game.cards[id].name} /><p className="truncate text-xs">{game.cards[id].name}</p><div className="flex gap-1"><Button onClick={() => store.dispatch({ type: "MOVE_MANY", ids: [id], to: "battlefield", at: "top" })}>Play</Button><Button onClick={() => env.ui.set((s) => ({ ...s, inspect: { cardId: id, big: true } }))}>Inspect</Button></div></div>)}</div>; }
