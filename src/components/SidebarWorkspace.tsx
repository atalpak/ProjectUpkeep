"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { addCardInstance } from "@/app/(app)/collection/actions";
import { EMPTY_STATE } from "@/app/(app)/collection/action-state";
import { moveWorkspaceCopy } from "@/app/(app)/collection/workspace-actions";
import { addDeckCard } from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { addWant } from "@/app/(app)/wants/actions";
import { Dialog } from "@/components/Dialog";
import { setCardPreviewMode } from "@/components/CardPreviewMode";
import { ManaCost } from "@/components/ManaCost";
import { Button, Input, Select, cx } from "@/components/ui";
import { groupDeck, type DeckSection } from "@/lib/collection/deck-view";
import { CARD_DRAG_TYPE, readCardDrag, type CardDrag } from "@/lib/ui/card-drag";
import { CONDITIONS, CONDITION_LABELS, FINISHES, FINISH_LABELS } from "@/lib/types";

type WorkspaceView = "card" | "decks" | "locations" | "wants";
type WorkspaceData = {
  decks: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  deckCards: Array<{ id: string; quantity: number; cards: { name: string; type_line: string | null; cmc: number | null; rarity: string | null; colors: string[] | null; mana_cost: string | null } | null }>;
  commanderEntryId: string | null;
  locationId: string;
  locationCards: Array<{ id: string; quantity: number; cards: { name: string } | null }>;
  wants: Array<{ id: string; name: string; quantity: number }>;
};

function WorkspaceIcon({ view }: { view: WorkspaceView }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (view === "card") return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
  if (view === "decks") return <svg {...common}><rect x="7" y="3" width="13" height="16" rx="2" /><path d="M4 7v12a2 2 0 0 0 2 2h11M10 8h7M10 12h6" /></svg>;
  if (view === "locations") return <svg {...common}><path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  return <svg {...common}><path d="M20.3 5.7a4.5 4.5 0 0 0-6.4 0L12 7.6l-1.9-1.9a4.5 4.5 0 0 0-6.4 6.4L12 20.4l8.3-8.3a4.5 4.5 0 0 0 0-6.4Z" /></svg>;
}

/** Persistent destinations; card details occupy their own full-height view. */
export function SidebarWorkspace({ details }: {
  details: ReactNode;
}) {
  const [view, setView] = useState<WorkspaceView>("card");
  const [deckId, setDeckId] = useState("");
  const [locationId, setLocationId] = useState("unsorted");
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [cardQuery, setCardQuery] = useState("");
  const locationPickerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<Extract<CardDrag, { kind: "catalog" }> | null>(null);
  const [pendingPlaceDrop, setPendingPlaceDrop] = useState<CardDrag | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const load = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ deck: deckId, location: locationId });
    const response = await fetch(`/api/sidebar-workspace?${params}`, { cache: "no-store", signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load the explorer.");
    setData(body as WorkspaceData);
    return body as WorkspaceData;
  }, [deckId, locationId]);

  useEffect(() => {
    if (view === "card") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      load(controller.signal).catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load the explorer.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [view, load]);

  useEffect(() => {
    if (!locationPickerOpen) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!locationPickerRef.current?.contains(event.target as Node)) {
        setLocationPickerOpen(false);
        setPendingPlaceDrop(null);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLocationPickerOpen(false);
        setPendingPlaceDrop(null);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [locationPickerOpen]);

  const targetDeck = data?.decks.find((d) => d.id === deckId) ?? data?.decks[0];
  const deckGroups = data ? groupDeck(data.deckCards, "name", data.commanderEntryId, { alwaysIncludeCommander: true }) : [];
  const places = [{ id: "unsorted", name: "Unsorted" }, ...(data?.locations ?? [])].sort((a, b) => a.id === "unsorted" ? -1 : b.id === "unsorted" ? 1 : a.name.localeCompare(b.name));
  const selectedPlace = places.find((place) => place.id === locationId) ?? places[0];
  const matchingPlaces = places.filter((place) => place.name.toLocaleLowerCase().includes(placeQuery.trim().toLocaleLowerCase()));
  const currentLocationCards = data?.locationId === locationId ? data.locationCards : null;
  const matchingCards = (currentLocationCards ?? [])
    .filter((row) => (row.cards?.name ?? "").toLocaleLowerCase().includes(cardQuery.trim().toLocaleLowerCase()))
    .sort((a, b) => (a.cards?.name ?? "").localeCompare(b.cards?.name ?? ""));

  function toggleSection(section: DeckSection) {
    const key = `${targetDeck?.id ?? ""}:${section}`;
    setCollapsedSections((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleDrop(item: CardDrag, destination: WorkspaceView, location = locationId) {
    setError(null); setNotice(null); setOver(null);
    if (destination === "locations") {
      if (item.kind === "copy") {
        setBusy(true);
        try {
          const result = await moveWorkspaceCopy(item.instanceId, location === "unsorted" ? null : location);
          if (result.error) throw new Error(result.error);
          if (location === locationId) await load();
          else setLocationId(location);
          setNotice(`Moved ${item.name}.`);
        } catch (e) { setError(e instanceof Error ? e.message : "Could not move that copy."); }
        finally { setBusy(false); }
      } else if (item.local) {
        setLocationId(location);
        setPendingLocation(item);
      } else {
        setError("This printing is not in Upkeep's catalog yet. Choose another printing to add it.");
      }
      return;
    }
    if (item.kind !== "catalog") {
      setError("Open this copy's card details to add it to a deck list or wish list.");
      return;
    }
    if (!item.local) {
      setError("This printing is not in Upkeep's catalog yet. Choose a catalog printing to add it.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("card_id", item.cardId); form.set("quantity", "1");
      if (destination === "decks") {
        const available = data ?? await load();
        const deck = available.decks.find((d) => d.id === deckId) ?? available.decks[0];
        if (!deck) throw new Error("Choose or create a deck first.");
        form.set("deck_id", deck.id);
        const result = await addDeckCard(EMPTY_DECK_STATE, form);
        if (result.error) throw new Error(result.error);
        setNotice(`Added ${item.name} to ${deck.name}.`);
      } else if (destination === "wants") {
        form.set("card_name", item.name);
        const result = await addWant(EMPTY_SOCIAL_STATE, form);
        if (result.error) throw new Error(result.error);
        setNotice(`Added ${item.name} to your wish list.`);
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add that card."); }
    finally { setBusy(false); }
  }

  function zone(destination: WorkspaceView, key: string, location?: string) {
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(CARD_DRAG_TYPE)) return;
        event.preventDefault(); event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === "move" ? "move" : "copy";
        setOver(key);
        if (destination === "locations" && key === "locations") {
          setView("locations");
          setLocationPickerOpen(true);
        }
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        const item = readCardDrag(event.dataTransfer);
        if (item) {
          setView(destination);
          if (destination === "locations" && location === undefined) {
            setPendingPlaceDrop(item);
            setPlaceQuery("");
            setLocationPickerOpen(true);
          } else {
            if (destination === "locations") {
              setPendingPlaceDrop(null);
              setLocationPickerOpen(false);
            }
            void handleDrop(item, destination, location);
          }
        }
      },
    };
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas">
      <div className="relative z-30 flex shrink-0 justify-center px-10 py-2">
        <div role="tablist" aria-label="Explorer views" className="flex items-center gap-1">
          {([["card", "Card"], ["decks", "Decks"], ["locations", "Locations"], ["wants", "Wish List"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} aria-label={label} aria-describedby={`explorer-tip-${id}`}
              {...(id === "card" ? {} : zone(id, id))}
              onClick={() => { setView(id); setError(null); if (id !== "locations") { setLocationPickerOpen(false); setPendingPlaceDrop(null); } }}
              className={cx("group relative flex size-9 items-center justify-center rounded-lg text-ink-muted motion-safe:transition-[background-color,transform,color] motion-safe:duration-200 hover:bg-surface-muted hover:text-ink motion-safe:hover:scale-105 focus-visible:outline-2 focus-visible:outline-focus-ring", view === id && "explorer-tab-active text-ink", over === id && "ring-2 ring-focus-ring")}>
              <WorkspaceIcon view={id} />
              <span id={`explorer-tip-${id}`} role="tooltip" className="pointer-events-none absolute top-full z-50 mt-2 whitespace-nowrap rounded bg-black px-2 py-1 text-[11px] text-white opacity-0 shadow-lg motion-safe:transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{label}</span>
            </button>
          ))}
        </div>
        <div className="absolute right-2 top-2 flex items-center">
          <button type="button" onClick={() => setCardPreviewMode("tooltip")} aria-label="Close explorer" aria-describedby="explorer-tip-close"
            className="group relative flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus-ring">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4"><path d="m9 6 6 6-6 6" /></svg>
            <span id="explorer-tip-close" role="tooltip" className="pointer-events-none absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded bg-black px-2 py-1 text-[11px] text-white opacity-0 shadow-lg motion-safe:transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Close explorer</span>
          </button>
        </div>
      </div>

      {view === "card" ? (
        <div className="animate-explorer-enter min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-2" key={view}>
          {details}
        </div>
      ) : (
        <div className="animate-explorer-enter flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-3" key={view}
          onDragEnter={view === "locations" ? (event) => { if (event.dataTransfer.types.includes(CARD_DRAG_TYPE)) setLocationPickerOpen(true); } : undefined}
          onDragOver={view === "locations" ? (event) => { if (event.dataTransfer.types.includes(CARD_DRAG_TYPE)) event.preventDefault(); } : undefined}
          onDrop={view === "locations" ? (event) => {
            if (event.defaultPrevented) return;
            const item = readCardDrag(event.dataTransfer);
            if (!item) return;
            event.preventDefault();
            setPendingPlaceDrop(item);
            setPlaceQuery("");
            setLocationPickerOpen(true);
          } : undefined}>
          {view === "decks" ? <>
            <label className="mb-2 text-xs font-medium">Deck
              <Select className="mt-1 w-full text-xs" value={targetDeck?.id ?? ""} onChange={(e) => setDeckId(e.target.value)}>
                {data?.decks.length ? data.decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>) : <option value="">No decks yet</option>}
              </Select>
            </label>
            <div {...zone("decks", "decks")} className={cx("min-h-24 flex-1 rounded-md p-1 motion-safe:transition-colors", over === "decks" && "bg-accent-soft ring-2 ring-accent")}>
              <p className="mb-3 px-1 text-xs text-ink-muted">Drag a search card here to add one to this list.</p>
              <div className="space-y-3">
                {deckGroups.map((group) => {
                  const collapsed = collapsedSections.has(`${targetDeck?.id ?? ""}:${group.section}`);
                  return <section key={group.section}>
                    <h3>
                      <button type="button" onClick={() => toggleSection(group.section)} aria-expanded={!collapsed}
                        className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus-ring">
                        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cx("size-3 shrink-0 text-ink-muted motion-safe:transition-transform", collapsed ? "-rotate-90" : "rotate-0")}><path d="m4 6 4 4 4-4" /></svg>
                        <span className="min-w-0 flex-1 truncate">{group.label}</span>
                        <span className="font-normal tabular-nums text-ink-muted">{group.cardCount}</span>
                      </button>
                    </h3>
                    {!collapsed ? <div className="mt-1 space-y-0.5 pl-1">
                      {group.rows.length ? group.rows.map((entry) => <div key={entry.id} className="flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-xs hover:bg-surface-muted">
                        <span className="w-6 shrink-0 text-right tabular-nums text-ink-muted">{entry.quantity}×</span>
                        <span className="min-w-0 flex-1 truncate" title={entry.cards?.name ?? "Unknown card"}>{entry.cards?.name ?? "Unknown card"}</span>
                        <ManaCost cost={entry.cards?.mana_cost} size="xs" />
                      </div>) : <p className="px-2 py-1 text-xs text-ink-muted">No commander set.</p>}
                    </div> : null}
                  </section>;
                })}
              </div>
              {data && data.deckCards.length >= 300 ? <p className="mt-2 text-xs text-ink-muted">Showing the first 300 entries.</p> : null}
              {!loading && data?.deckCards.length === 0 ? <p className="text-xs text-ink-muted">The list is empty.</p> : null}
            </div>
          </> : view === "locations" ? <>
            <div ref={locationPickerRef} className="relative mb-3">
              <span className="mb-1 block text-xs font-medium text-ink-muted">Location</span>
              <button type="button" aria-label={`Choose location, current: ${selectedPlace.name}`} aria-expanded={locationPickerOpen} aria-controls="explorer-place-picker"
                onClick={() => { setPlaceQuery(""); if (locationPickerOpen) setPendingPlaceDrop(null); setLocationPickerOpen((open) => !open); }}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus-ring">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4 shrink-0 text-ink-muted"><path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
                <span className="min-w-0 flex-1 truncate font-medium">{selectedPlace.name}</span>
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cx("size-3 shrink-0 text-ink-muted motion-safe:transition-transform", locationPickerOpen && "rotate-180")}><path d="m4 6 4 4 4-4" /></svg>
              </button>
              {locationPickerOpen ? <div id="explorer-place-picker" className="absolute inset-x-0 top-full z-40 mt-1 rounded-lg border border-border bg-surface p-2 shadow-[var(--shadow-raised)]">
                {pendingPlaceDrop ? <p className="mb-2 truncate px-1 text-xs font-medium" title={pendingPlaceDrop.name}>Choose a location for {pendingPlaceDrop.name}</p> : null}
                <div className="relative mb-2">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
                  <Input value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} aria-label="Search locations" placeholder="Search locations…" className="pl-9 text-xs" />
                </div>
                <div className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain" aria-label="Locations">
                  {matchingPlaces.map((place) => <button key={place.id} type="button" {...zone("locations", place.id, place.id)}
                    onClick={() => {
                      setLocationPickerOpen(false);
                      setCardQuery("");
                      if (pendingPlaceDrop) {
                        const item = pendingPlaceDrop;
                        setPendingPlaceDrop(null);
                        void handleDrop(item, "locations", place.id);
                      } else setLocationId(place.id);
                    }}
                    aria-current={locationId === place.id ? "true" : undefined}
                    className={cx("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus-ring", locationId === place.id && "bg-surface-muted font-semibold", over === place.id && "bg-accent-soft ring-2 ring-accent")}>
                    <span className="min-w-0 flex-1 truncate">{place.name}</span>
                    {locationId === place.id ? <span aria-hidden="true" className="text-accent-text">✓</span> : null}
                  </button>)}
                  {matchingPlaces.length === 0 ? <p className="px-2 py-3 text-center text-xs text-ink-muted">No matching locations.</p> : null}
                </div>
                <p className="mt-2 px-1 text-[11px] text-ink-muted">{pendingPlaceDrop ? "Select a destination to continue." : "Drop a card on a location to file it there."}</p>
              </div> : null}
            </div>
            <label className="mb-2 block text-xs font-medium text-ink-muted">Cards in {selectedPlace.name}
              <div className="relative mt-1">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
                <Input value={cardQuery} onChange={(event) => setCardQuery(event.target.value)} placeholder="Search cards here…" className="pl-9 text-xs" />
              </div>
            </label>
            <div {...zone("locations", locationId, locationId)} className={cx("min-h-24 flex-1 rounded-lg p-1 motion-safe:transition-colors", over === locationId && "bg-accent-soft ring-2 ring-accent")}>
              <p className="mb-1 px-1 text-[11px] text-ink-muted">{matchingCards.length} {cardQuery.trim() ? "matching " : ""}stack{matchingCards.length === 1 ? "" : "s"} · drag a stack to move it</p>
              {matchingCards.map((row) => <div key={row.id} draggable
                onDragStart={(event) => { event.dataTransfer.setData(CARD_DRAG_TYPE, JSON.stringify({ kind: "copy", instanceId: row.id, name: row.cards?.name ?? "Card" })); event.dataTransfer.effectAllowed = "move"; setLocationPickerOpen(true); }}
                className="flex cursor-grab items-center gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-surface-muted active:cursor-grabbing">
                <span className="min-w-0 flex-1 truncate">{row.cards?.name ?? "Unknown card"}</span><span className="tabular-nums text-ink-muted">×{row.quantity}</span>
              </div>)}
              {currentLocationCards && currentLocationCards.length >= 300 ? <p className="mt-2 text-xs text-ink-muted">Showing the first 300 stacks.</p> : null}
              {!loading && currentLocationCards?.length === 0 ? <p className="px-1 py-2 text-xs text-ink-muted">No cards in this location yet. Drop one here to add it.</p> : null}
              {!loading && currentLocationCards && currentLocationCards.length > 0 && matchingCards.length === 0 ? <p className="px-1 py-2 text-xs text-ink-muted">No cards match “{cardQuery}”.</p> : null}
            </div>
          </> : <div {...zone("wants", "wants")} className={cx("min-h-24 flex-1 rounded-md border border-dashed border-border p-2 motion-safe:transition-colors", over === "wants" && "border-accent bg-accent-soft ring-2 ring-accent")}>
            <p className="mb-2 text-xs text-ink-muted">Drag a search card here to add it to your wish list.</p>
            {data?.wants.map((want) => <div key={want.id} className="flex gap-2 border-t border-border py-1.5 text-xs"><span className="min-w-0 flex-1 truncate">{want.name}</span><span>×{want.quantity}</span></div>)}
            {!loading && data?.wants.length === 0 ? <p className="text-xs text-ink-muted">Your wish list is empty.</p> : null}
          </div>}
          {loading ? <p role="status" className="mt-2 text-xs text-ink-muted">Loading…</p> : null}
          {busy ? <p role="status" className="mt-2 text-xs text-ink-muted">Saving…</p> : null}
          {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
          {notice ? <p role="status" className="mt-2 text-xs text-accent-text">{notice}</p> : null}
        </div>
      )}

      {pendingLocation ? <Dialog open onClose={() => setPendingLocation(null)} label="Add a copy to your collection" className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(90vw,21rem)] overflow-y-auto rounded-xl p-4">
        <form action={async (form) => {
            setBusy(true); setError(null);
            try {
              const result = await addCardInstance(EMPTY_STATE, form);
              if (result.error) setError(result.error);
              else { setPendingLocation(null); setNotice(result.notice); await load(); }
            } catch (e) { setError(e instanceof Error ? e.message : "Could not add that copy."); }
            finally { setBusy(false); }
          }} className="space-y-3 text-sm">
            <p>Add a new owned copy of {pendingLocation.name} to {locationId === "unsorted" ? "Unsorted" : data?.locations.find((l) => l.id === locationId)?.name}?</p>
            <input type="hidden" name="card_id" value={pendingLocation.cardId} />
            <input type="hidden" name="card_name" value={pendingLocation.name} />
            <input type="hidden" name="location_id" value={locationId === "unsorted" ? "" : locationId} />
            <label className="block">Condition <Select name="condition" defaultValue="NM" className="mt-1 w-full text-xs">{CONDITIONS.map((condition) => <option key={condition} value={condition}>{CONDITION_LABELS[condition]}</option>)}</Select></label>
            <label className="block">Finish <Select name="finish" defaultValue="nonfoil" className="mt-1 w-full text-xs">{FINISHES.map((finish) => <option key={finish} value={finish}>{FINISH_LABELS[finish]}</option>)}</Select></label>
            <input type="hidden" name="language" value="en" />
            <label className="block">Quantity <Input name="quantity" type="number" min={1} defaultValue={1} className="mt-1 w-full text-xs" /></label>
            {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
            <div className="flex gap-2"><Button type="submit" disabled={busy} className="text-xs">Add copy</Button><Button type="button" variant="secondary" onClick={() => setPendingLocation(null)} className="text-xs">Cancel</Button></div>
          </form>
      </Dialog> : null}

    </div>
  );
}
