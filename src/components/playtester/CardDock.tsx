"use client";

import { useEffect, useState } from "react";

import { CardArt } from "./CardArt";
import { usePlayEnv, useSettings, useUi } from "./context";
import { useCard } from "./hooks/useStore";
import { CardDetailsDock, useShowCardDetails } from "@/components/CardPanel";
import { prefsKey } from "@/lib/playtest/recovery";
import { textFor } from "@/lib/playtest/catalog";
import type { Settings } from "@/lib/playtest/settings";
import type { PlayEnv } from "./context";

/**
 * The card-detail column beside the table: the same details the app's card
 * sidebar shows (`CardDetailsDock` draws the shared `CardDetails`), following
 * whichever card the pointer or keyboard focus is on, and keeping the last one
 * when the pointer leaves so a glance across the table is not a strobe.
 *
 * Wide windows only (`xl`, the same width the app's own sidebar needs). On a
 * narrower window, or with the column switched off, hovering shows the small
 * floating preview in CardInspector instead.
 *
 * A card the catalogue cannot look up (a custom token, the development
 * fixture, a page outside the provider) falls back to what the table itself
 * knows: the picture, the type line and the oracle text it already holds.
 */

/** Persist one table preference. Same key and store as the settings dialog. */
export function setPreference<K extends keyof Settings>(env: PlayEnv, key: K, value: Settings[K]) {
  const next = { ...env.settings.get(), [key]: value };
  env.settings.set(() => next);
  try {
    localStorage.setItem(prefsKey(env.userId), JSON.stringify(next));
  } catch {
    /* preference storage is optional */
  }
}

export function CardDock() {
  const env = usePlayEnv();
  const settings = useSettings();
  const inspect = useUi((s) => s.inspect);
  const show = useShowCardDetails();
  const [lastId, setLastId] = useState<string | null>(null);
  const hoveredId = inspect && !inspect.big ? inspect.cardId : null;
  if (hoveredId !== null && hoveredId !== lastId) setLastId(hoveredId);
  const card = useCard(lastId ?? "");
  const scryfallId = card?.cardId ?? null;
  useEffect(() => {
    if (scryfallId && show) show(scryfallId);
  }, [scryfallId, show]);

  if (!settings.cardDetails) return null;
  const known = scryfallId !== null && show !== null;
  const text = card ? textFor(env.catalog.get(card.cardId ?? ""), card.face === "back" ? "back" : "front") : null;
  return (
    <aside aria-label="Card details" aria-live="polite" className="hidden w-72 shrink-0 overflow-y-auto border-l border-border bg-canvas/60 p-3 xl:block">
      {known ? (
        <CardDetailsDock />
      ) : card ? (
        <div className="space-y-2 text-sm">
          <CardArt src={card.imageNormal ?? card.imageSmall} alt={card.name} label={card.name} />
          <h2 className="font-semibold">{card.name}</h2>
          <p className="text-ink-muted">{[text?.manaCost, text?.typeLine ?? card.typeLine].filter(Boolean).join(" · ")}</p>
          <p className="whitespace-pre-wrap">{text?.text ?? ""}</p>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Hover a card to see it here.</p>
      )}
    </aside>
  );
}

/** The top-left switch, drawn like the app header's sidebar toggle. */
export function CardDockToggle() {
  const env = usePlayEnv();
  const on = useSettings().cardDetails;
  const label = on ? "Hide the card details column" : "Show the card details column";
  return (
    <button
      type="button"
      onClick={() => setPreference(env, "cardDetails", !on)}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className="hidden items-center gap-1.5 rounded-md px-1.5 py-1 text-ink-muted hover:bg-white/10 hover:text-ink xl:flex"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" className="size-4">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
        {on ? <path d="M15 4h6v16h-6z" fill="currentColor" stroke="none" /> : null}
      </svg>
      Card details
    </button>
  );
}
