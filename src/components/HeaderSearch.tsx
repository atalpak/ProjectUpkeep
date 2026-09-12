"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MIN_TERM, type LocatedCard } from "@/lib/collection/locate";
import {
  COLORS,
  COLOR_LABELS,
  COLOR_MODES,
  COLOR_MODE_LABELS,
  NUMERIC_OPS,
  NUMERIC_OP_LABELS,
  RARITIES,
  type NumericFilter,
} from "@/lib/collection/filters";
import {
  EMPTY_ADVANCED_FILTER,
  advancedFilterToParams,
  isAdvancedFilterActive,
  type AdvancedCardFilter,
} from "@/lib/cards/search-query";
import { readRecentSearches, recordRecentSearch } from "@/lib/search/recent-searches";
import { useCardPanel } from "@/components/CardPanel";
import { ManaSymbol } from "@/components/ManaCost";
import { cx } from "@/components/ui";

/**
 * Search every card, from the chrome.
 *
 * Type a name and the dropdown fills with matches from all of Magic (the local
 * `cards` mirror, so it stays fast and offline). A card you own carries a
 * lighter line saying how many and where; a card a friend has open for trade
 * carries a second one naming them and their container — the same "who has
 * this?" answer /find gives, compact enough for a dropdown. Picking one opens
 * the card popup — full detail, a printing switcher, and add-to-collection /
 * add-to-deck — over whatever page you were on, owned or not.
 *
 * Three things layer on top of that basic lookup:
 *   - A spinner replaces the search icon the instant there is enough to look
 *     up, and stays until that lookup resolves — the field never sits still
 *     while a request is in flight.
 *   - Focusing an empty field surfaces the searches actually run recently
 *     (settled fetches, not every keystroke), in italic, so returning to a
 *     card you looked up a minute ago does not mean retyping it.
 *   - "Advanced Search" — where a link out to /find used to sit — expands a
 *     panel of Scryfall-style facets (colour, mana value, type, oracle text,
 *     set, rarity) plus a box that takes literal Scryfall syntax and passes
 *     it through the same way. See `src/lib/cards/search-query.ts` for
 *     exactly which slice of that syntax is understood.
 *
 * Below lg there is no room for the field, so the same thing is an icon that
 * goes to the full card finder.
 */

/** Long enough that a fast typist does not fire a request per character. */
const DEBOUNCE_MS = 180;

type CardHit = {
  name: string;
  printing_count: number;
  sample_image_uri: string | null;
  sample_card_id: string | null;
  sample_flavor_name: string | null;
};

/** One card a friend has open for trade, resolved and capped by the API route. */
type FriendHit = {
  name: string;
  displayName: string;
  suppliers: Array<{ username: string; available: number; locations: string[] }>;
  /** Suppliers beyond the ones already in `suppliers` — the route caps at a
   *  couple of lines; /find has room for the rest. */
  moreSuppliers: number;
};

type Result = CardHit & { owned: LocatedCard | null; friends: FriendHit | null };

export function HeaderSearch() {
  const router = useRouter();
  const { open } = useCardPanel();
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);

  const [value, setValue] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // -1 is the input itself: arrowing back up past the first result returns
  // focus to what was typed rather than trapping the selection in the list.
  const [active, setActive] = useState(-1);

  // Read lazily rather than on mount: this list is never part of the first
  // paint (the dropdown starts closed), so there is nothing for a server
  // render to disagree with, and no need for the external-store dance the
  // sync-across-tabs cases in this app use.
  const [recent, setRecent] = useState<string[]>([]);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedCardFilter>(EMPTY_ADVANCED_FILTER);
  const [rawQuery, setRawQuery] = useState("");
  const [unsupported, setUnsupported] = useState<string[]>([]);

  const term = value.trim();
  const advancedActive = isAdvancedFilterActive(advanced) || rawQuery.trim() !== "";

  // Cmd/Ctrl-K focuses the field, the shortcut people already try.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close when the focus or the pointer goes elsewhere.
  useEffect(() => {
    if (!dropdownOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [dropdownOpen]);

  // Debounced lookup: every card matching the fragment, plus which of them are
  // in the collection. Aborted when the query moves on so a slow response can
  // never land after a newer one. Fires either for a plain name (the common
  // case, unchanged) or, once Advanced Search has a facet or a raw query set,
  // for that instead — a color/type/etc. search with no name typed still runs.
  useEffect(() => {
    if (term.length < MIN_TERM && !advancedActive) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const cardParams = new URLSearchParams();
        if (rawQuery.trim() !== "") {
          cardParams.set("raw", rawQuery.trim());
        } else {
          if (term) cardParams.set("q", term);
          for (const [key, val] of advancedFilterToParams(advanced)) {
            if (key !== "q") cardParams.set(key, val);
          }
        }

        const requests: Promise<Response>[] = [
          fetch(`/api/cards/search?${cardParams}`, { signal: controller.signal }),
        ];
        // The "do I already have this?" / "does a friend?" lookup only makes
        // sense for a name — a colour-only search has no single term to ask it.
        if (term.length >= MIN_TERM) {
          requests.push(
            fetch(`/api/collection/locate?q=${encodeURIComponent(term)}`, {
              signal: controller.signal,
            }),
          );
        }

        const [cardsRes, mineRes] = await Promise.all(requests);
        if (!cardsRes.ok) return;

        const cardsJson = await cardsRes.json();
        const cards = (cardsJson.results ?? []) as CardHit[];
        setUnsupported((cardsJson.unsupported ?? []) as string[]);

        const mineJson = mineRes?.ok ? await mineRes.json() : { results: [], friends: [] };
        const mine = (mineJson.results ?? []) as LocatedCard[];
        const friendHits = (mineJson.friends ?? []) as FriendHit[];
        const ownedByName = new Map(mine.map((c) => [c.name.toLowerCase(), c]));
        const friendsByName = new Map(friendHits.map((f) => [f.name.toLowerCase(), f]));

        setResults(
          cards.map((c) => ({
            ...c,
            owned: ownedByName.get(c.name.toLowerCase()) ?? null,
            friends: friendsByName.get(c.name.toLowerCase()) ?? null,
          })),
        );
        setActive(-1);
        setDropdownOpen(true);

        // A search that actually ran and came back, not every keystroke —
        // the debounce above already keeps this to settled lookups.
        const settledTerm = rawQuery.trim() || term;
        if (settledTerm) setRecent(recordRecentSearch(settledTerm));
      } catch {
        // Aborted, or offline. The field still works as a way to reach /find.
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    // No setLoading(false) here: the spinner already went on synchronously —
    // in the input's onChange, so it does not wait out the debounce — and
    // resetting it on every re-run of this effect would flicker it off again
    // for the length of that debounce. The fetch's own `finally` is what
    // turns it off, once a request actually lands.
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, advancedActive, advanced, rawQuery]);

  function pick(result: Result) {
    if (!result.sample_card_id) return;
    setDropdownOpen(false);
    input.current?.blur();
    open(result.sample_card_id);
  }

  function pickRecent(searched: string) {
    setValue(searched);
    setRawQuery("");
    setLoading(true);
    input.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setDropdownOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setDropdownOpen(true);
      setActive((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        if (next < -1) return results.length - 1;
        if (next >= results.length) return -1;
        return next;
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0 && results[active]) pick(results[active]);
      else if (term) {
        setDropdownOpen(false);
        setRecent(recordRecentSearch(term));
        router.push(`/find?q=${encodeURIComponent(term)}`);
      }
    }
  }

  const showRecent = dropdownOpen && term.length < MIN_TERM && !advancedActive;

  return (
    // A growing spacer, not just the field itself: this is what lets the
    // account cluster stay flush with the right edge of the bar without an
    // `ml-auto` on it. Below `lg` the only visible child is the icon link, so
    // `justify-end` keeps it glued to that cluster exactly where `ml-auto`
    // used to put it; from `lg` up the field itself grows (`lg:flex-1` below),
    // so `lg:justify-start` lets it hug the nav links instead, leaving any
    // space beyond its cap in front of the icons rather than before it.
    <div className="flex min-w-0 flex-1 items-center justify-end lg:justify-start">
      <div ref={container} className="relative hidden min-w-0 lg:block lg:flex-1 lg:max-w-md xl:max-w-lg">
        <label className="relative block">
          <span className="sr-only">Search all cards</span>
          {loading ? (
            <Spinner className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          ) : (
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          )}
          <input
            ref={input}
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              setRawQuery("");
              if (next.trim().length < MIN_TERM && !advancedActive) {
                setResults([]);
                setDropdownOpen(false);
                setLoading(false);
              } else {
                // Shown the instant there is enough to look up, rather than
                // waiting out the debounce below — a still icon while a
                // request is about to fire reads as nothing having happened.
                setLoading(true);
              }
            }}
            onFocus={() => {
              if (results.length > 0) setDropdownOpen(true);
              else if (term.length < MIN_TERM) {
                setRecent(readRecentSearches());
                setDropdownOpen(true);
              }
            }}
            onKeyDown={onKeyDown}
            placeholder="Search cards…"
            role="combobox"
            aria-expanded={dropdownOpen}
            aria-controls="header-search-results"
            aria-autocomplete="list"
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-sm placeholder:text-ink-muted"
          />
        </label>

        {dropdownOpen ? (
          <div
            id="header-search-results"
            role="listbox"
            className="absolute right-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
          >
            {showRecent ? (
              recent.length > 0 ? (
                <ul className="py-1">
                  {recent.map((searched) => (
                    <li key={searched}>
                      <button
                        type="button"
                        onClick={() => pickRecent(searched)}
                        className="block w-full px-3 py-2 text-left text-sm italic text-ink-muted transition-colors hover:bg-surface-muted"
                      >
                        {searched}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-3 text-sm text-ink-muted">
                  Type a card name, or open Advanced Search below.
                </p>
              )
            ) : results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-ink-muted">
                {loading ? "Searching…" : `No card matches “${rawQuery.trim() || term}”.`}
              </p>
            ) : (
              <ul className="max-h-96 overflow-y-auto py-1">
                {results.map((card, index) => (
                  <li key={card.name}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onClick={() => pick(card)}
                      onMouseEnter={() => setActive(index)}
                      className={cx(
                        "block w-full px-3 py-2 text-left text-sm transition-colors",
                        index === active ? "bg-surface-muted" : "hover:bg-surface-muted",
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{card.name}</span>
                        <span className="shrink-0 text-xs text-ink-muted">
                          {card.printing_count} print{card.printing_count === 1 ? "" : "s"}
                        </span>
                      </span>
                      {card.owned ? (
                        <span className="mt-0.5 block truncate text-xs text-ink-muted">
                          {card.owned.total} in your collection
                          {card.owned.places.length > 0
                            ? ` · ${card.owned.places
                                .map((place) => `${place.name} ×${place.quantity}`)
                                .join(" · ")}`
                            : ""}
                        </span>
                      ) : null}
                      {card.friends && card.friends.suppliers.length > 0 ? (
                        <span className="mt-0.5 block truncate text-xs text-accent">
                          {card.friends.suppliers[0].username} has{" "}
                          {card.friends.suppliers[0].available}
                          {card.friends.suppliers[0].locations[0]
                            ? ` in ${card.friends.suppliers[0].locations[0]}`
                            : ""}
                          {card.friends.suppliers.length > 1 || card.friends.moreSuppliers > 0
                            ? ` +${
                                card.friends.suppliers.length - 1 + card.friends.moreSuppliers
                              } more`
                            : ""}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!showRecent && unsupported.length > 0 ? (
              <p className="border-t border-border px-3 py-2 text-xs text-ink-muted">
                Not understood, so ignored: {unsupported.join(" ")}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className={cx(
                "flex w-full items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium text-accent transition-colors hover:bg-surface-muted coarse:min-h-11",
                advancedActive && "bg-accent-soft",
              )}
            >
              <span>Advanced Search{advancedActive ? " (active)" : ""}</span>
              <ChevronIcon className={cx("size-4 transition-transform", advancedOpen && "rotate-180")} />
            </button>

            {advancedOpen ? (
              <AdvancedSearchPanel
                filter={advanced}
                onFilterChange={setAdvanced}
                raw={rawQuery}
                onRawChange={setRawQuery}
                onClear={() => {
                  setAdvanced(EMPTY_ADVANCED_FILTER);
                  setRawQuery("");
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Below lg the field would not fit, so the destination is offered directly. */}
      <Link
        href="/find"
        aria-label="Find a card"
        title="Find a card"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink coarse:size-11 lg:hidden"
      >
        <SearchIcon className="size-4" />
      </Link>
    </div>
  );
}

/**
 * The facet controls under "Advanced Search" — modelled directly on
 * `CollectionFilters`' own disclosure panel, cut down to the handful of
 * Scryfall facets most worth having first: colour, mana value, type, oracle
 * text, set and rarity. The raw box at the bottom takes literal syntax
 * (`c:r cmc<=2 t:creature`, straight from https://scryfall.com/docs/syntax)
 * and, when it has anything in it, speaks for the whole search — see
 * `src/lib/cards/search-query.ts` for exactly what it understands.
 */
function AdvancedSearchPanel({
  filter,
  onFilterChange,
  raw,
  onRawChange,
  onClear,
}: {
  filter: AdvancedCardFilter;
  onFilterChange: (filter: AdvancedCardFilter) => void;
  raw: string;
  onRawChange: (raw: string) => void;
  onClear: () => void;
}) {
  const set = <K extends keyof AdvancedCardFilter>(key: K, value: AdvancedCardFilter[K]) =>
    onFilterChange({ ...filter, [key]: value });

  const rawActive = raw.trim() !== "";

  return (
    <div className="space-y-3 border-t border-border bg-surface p-3">
      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((color) => {
          const on = filter.colors.includes(color);
          return (
            <label
              key={color}
              title={COLOR_LABELS[color]}
              className={cx(
                "flex cursor-pointer items-center justify-center rounded-md border p-1.5 transition-colors",
                rawActive && "opacity-40",
                on
                  ? "border-accent bg-accent-soft ring-1 ring-accent"
                  : "border-border opacity-60 hover:bg-surface-muted hover:opacity-100",
              )}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={rawActive}
                onChange={() =>
                  set("colors", on ? filter.colors.filter((c) => c !== color) : [...filter.colors, color])
                }
                className="sr-only"
              />
              <ManaSymbol code={color} />
              <span className="sr-only">{COLOR_LABELS[color]}</span>
            </label>
          );
        })}
        <select
          value={filter.colorMode}
          disabled={rawActive}
          onChange={(e) => set("colorMode", e.target.value as AdvancedCardFilter["colorMode"])}
          aria-label="How to match colors"
          className="rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-40"
        >
          {COLOR_MODES.filter((m) => m !== "any").map((mode) => (
            <option key={mode} value={mode}>
              {COLOR_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-muted">Mana value</span>
          <div className="flex gap-1">
            <select
              value={filter.cmc?.op ?? "eq"}
              disabled={rawActive}
              onChange={(e) => {
                const op = e.target.value as NonNullable<NumericFilter>["op"];
                if (filter.cmc === null) return;
                set("cmc", { op, value: filter.cmc.value });
              }}
              className="w-20 rounded-md border border-border bg-surface px-1 text-xs disabled:opacity-40"
            >
              {NUMERIC_OPS.map((op) => (
                <option key={op} value={op}>
                  {NUMERIC_OP_LABELS[op]}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={filter.cmc === null ? "" : String(filter.cmc.value)}
              disabled={rawActive}
              onChange={(e) => {
                const text = e.target.value;
                if (text.trim() === "") return set("cmc", null);
                const n = Number.parseFloat(text);
                set("cmc", Number.isFinite(n) ? { op: filter.cmc?.op ?? "eq", value: n } : null);
              }}
              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-xs disabled:opacity-40"
            />
          </div>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-muted">Rarity</span>
          <select
            value={filter.rarity}
            disabled={rawActive}
            onChange={(e) => set("rarity", e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs disabled:opacity-40"
          >
            <option value="">Any</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="col-span-2 space-y-1">
          <span className="text-xs font-medium text-ink-muted">Type line</span>
          <input
            value={filter.type}
            disabled={rawActive}
            onChange={(e) => set("type", e.target.value)}
            placeholder="Creature — Goblin"
            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs disabled:opacity-40"
          />
        </label>

        <label className="col-span-2 space-y-1">
          <span className="text-xs font-medium text-ink-muted">Rules text</span>
          <input
            value={filter.oracle}
            disabled={rawActive}
            onChange={(e) => set("oracle", e.target.value)}
            placeholder="draw a card"
            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs disabled:opacity-40"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-muted">Set</span>
          <input
            value={filter.set}
            disabled={rawActive}
            onChange={(e) => set("set", e.target.value)}
            placeholder="znr"
            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs disabled:opacity-40"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-muted">
          Or paste Scryfall syntax — takes over from the fields above
        </span>
        <input
          value={raw}
          onChange={(e) => onRawChange(e.target.value)}
          placeholder="c:r cmc<=2 t:creature"
          className={cx(
            "w-full rounded-md border bg-surface px-2 py-1 text-xs",
            rawActive ? "border-accent" : "border-border",
          )}
        />
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-ink-muted underline hover:text-ink"
        >
          Clear advanced search
        </button>
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m5 7.5 5 5 5-5" />
    </svg>
  );
}

/** A quarter-turn gap in the ring reads as motion once it spins — the same
 *  weight as `SearchIcon`, so the field does not shift when one replaces the
 *  other. Tailwind's `animate-spin` is the only "loading" affordance in the
 *  app so far; this is the pattern to reuse rather than a second one. */
function Spinner({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={cx("animate-spin", className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
