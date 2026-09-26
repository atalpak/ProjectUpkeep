"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MIN_TERM, type LocatedCard } from "@/lib/collection/locate";
import { specToParams } from "@upkeep/domain";

import { readRecentSearches, recordRecentSearch } from "@/lib/search/recent-searches";
import { useCardPanel } from "@/components/CardPanel";
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
 * Stays a basic, fast name finder by default, but literal Scryfall syntax
 * "just works" if typed directly into it — no separate mode to switch into.
 * `parseScryfallQuery` runs over whatever is typed; the moment it recognises
 * a real operator (`c:r`, `cmc<=2`, `t:creature`, …) the lookup switches from
 * a plain name search to the same structured query `/api/cards/suggestions`'s
 * advanced path understands, rather than treating the colons as literal name
 * characters. See `src/lib/cards/search-query.ts` for exactly what is read.
 *
 * Three more things layer on top of that basic lookup:
 *   - A spinner replaces the search icon the instant there is enough to look
 *     up, and stays until that lookup resolves — the field never sits still
 *     while a request is in flight.
 *   - Focusing an empty field surfaces the searches actually run recently
 *     (settled fetches, not every keystroke), in italic, so returning to a
 *     card you looked up a minute ago does not mean retyping it.
 *   - "Advanced Search" at the bottom of the dropdown is a link to `/search`
 *     — a dedicated page shaped like Scryfall's own advanced search, with the
 *     structured facets, a raw syntax box, and a Search button, rather than a
 *     panel that used to expand in place here. Whatever is half-typed carries
 *     over as that page's initial query.
 *
 * Below lg there is no room for the field, so the same thing is an icon that
 * goes straight to Advanced Search — the magnifying glass inside the field
 * itself is the same link, once the field exists to hold it.
 */

/**
 * Does what was typed carry search syntax rather than being a plain name?
 * Purely lexical — an operator glued to a value (`t:elf`, so a name like
 * "Circle of Protection: Red" stays a name), comparison, parenthesis, negation or shorthand directive. It never interprets the query
 * (Scryfall does that on submit); it only decides that name suggestions would
 * be misleading, so the dropdown offers to run the whole query instead.
 */
const looksLikeSyntax = (term: string): boolean => /[a-z]+[:<>=]\S|[<>]=?|[()]|(^|\s)[-!]\S|\+\+|@@/i.test(term);

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
  const pathname = usePathname();
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

  // This field lives in the signed-in layout, so it survives every in-app
  // navigation rather than remounting per page — without this, whatever was
  // typed to reach one page (Advanced Search, a card popup, /find) would
  // still be sitting there on the next one, reading as a search that followed
  // you around rather than one that was already answered. The "adjust state
  // during render when a prop changes" pattern (react.dev's own name for
  // this), not an effect: a `useEffect` clearing this would run one render
  // late, showing the stale term for a frame on every navigation before
  // wiping it.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setValue("");
    setDropdownOpen(false);
    // `loading` goes on synchronously in `onChange`, before the debounce
    // below ever fires — type a few characters then navigate away (Enter,
    // or any link) inside that window and `term` becomes "" here before the
    // debounced effect's timer runs. Its cleanup aborts and its body bails
    // out early on the now-empty term without ever reaching the `fetch`'s
    // `finally`, so nothing would otherwise turn the spinner back off.
    setLoading(false);
  }

  // Read lazily rather than on mount: this list is never part of the first
  // paint (the dropdown starts closed), so there is nothing for a server
  // render to disagree with, and no need for the external-store dance the
  // sync-across-tabs cases in this app use.
  const [recent, setRecent] = useState<string[]>([]);

  const term = value.trim();
  // Syntax is never previewed locally: suggestions are name lookups only.
  const isSyntax = looksLikeSyntax(term);

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
  // never land after a newer one. Sends `q` for a plain name (the common
  // case) or `raw` once `looksAdvanced` says the typed text carries real
  // syntax the lookup is skipped (see `looksLikeSyntax`) and only the
  // submit action is offered.
  useEffect(() => {
    if (term.length < MIN_TERM || isSyntax) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const cardParams = new URLSearchParams();
        cardParams.set("q", term);

        const [cardsRes, mineRes] = await Promise.all([
          fetch(`/api/cards/suggestions?${cardParams}`, { signal: controller.signal }),
          // The "do I already have this?" / "does a friend?" lookup treats
          // whatever was typed as a literal name — harmless when it is really
          // Scryfall syntax, since that just matches nothing.
          fetch(`/api/collection/locate?q=${encodeURIComponent(term)}`, {
            signal: controller.signal,
          }),
        ]);
        if (!cardsRes.ok) return;

        const cardsJson = await cardsRes.json();
        const cards = (cardsJson.results ?? []) as CardHit[];

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
        setRecent(recordRecentSearch(term));
      } catch {
        // Aborted, or offline. The field still works as a way to reach /find.
      } finally {
        // An aborted request must not clear the spinner a newer one turned on.
        if (!controller.signal.aborted) setLoading(false);
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
  }, [term, isSyntax]);

  function pick(result: Result) {
    if (!result.sample_card_id) return;
    setDropdownOpen(false);
    input.current?.blur();
    open(result.sample_card_id);
  }

  function pickRecent(searched: string) {
    setValue(searched);
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
      // An IME choosing a candidate is not a submit.
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (active >= 0 && results[active]) pick(results[active]);
      else submitQuery();
    }
  }

  /** Every nonempty query — a name or syntax — runs on the same path as `/search`. */
  function submitQuery() {
    if (!term) return;
    setDropdownOpen(false);
    setRecent(recordRecentSearch(term));
    input.current?.blur();
    router.push(`/search?${specToParams({ q: term, page: 1 })}`);
  }

  const showRecent = dropdownOpen && term.length < MIN_TERM;

  // Deliberately never carries the half-typed term over: Advanced Search is
  // its own fresh session every time, not a continuation of whatever was
  // mid-type here — landing there with an old query already filled in (and
  // the Filters panel consequently forced open, since it opens by default
  // whenever a filter is already active) read as glued to this box rather
  // than a destination of its own.
  const advancedHref = "/search";

  return (
    // A growing spacer, not just the field itself: this is what lets the
    // nav links stay flush with the left edge of the bar without needing an
    // `ml-auto` elsewhere. `justify-end` at every width keeps the field (or,
    // below `lg`, the icon link) glued to the account cluster that follows
    // it, so any slack in the bar collects before the search field rather
    // than between it and the alerts icon.
    <div className="flex min-w-0 flex-1 items-center justify-end">
      <div ref={container} className="relative hidden min-w-0 lg:block lg:w-full lg:max-w-md xl:max-w-lg">
        <label className="relative block">
          <span className="sr-only">Search all cards</span>
          {loading ? (
            <Spinner className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          ) : (
            // Not just a decorative glyph any more: it is the field's own
            // shortcut to Advanced Search — always a fresh session there,
            // never whatever is half-typed here (see `advancedHref` above).
            <Link
              href={advancedHref}
              aria-label="Advanced Search"
              title="Advanced Search"
              className="absolute left-2.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-ink-muted transition-colors hover:text-ink"
            >
              <SearchIcon className="size-4" />
            </Link>
          )}
          <input
            ref={input}
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              setActive(-1);
              if (looksLikeSyntax(next.trim())) {
                // Nothing to preview; offer to run the whole query.
                setResults([]);
                setLoading(false);
                setDropdownOpen(true);
              } else if (next.trim().length < MIN_TERM) {
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
            aria-activedescendant={active >= 0 ? `header-search-option-${active}` : undefined}
            aria-autocomplete="list"
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-sm placeholder:text-ink-muted"
          />
        </label>

        {dropdownOpen ? (
          <div
            id="header-search-results"
            role="listbox"
            // Full width of the input, not a fixed 20rem anchored to its right
            // edge — a wide match ("Lightning Bolt // Lightning Bolt") used to
            // truncate against a box narrower than the field above it. z-40 is
            // a deliberate step above the sticky header's own z-10: nothing in
            // the tree currently competes with it, but a full-bleed page
            // banner sitting behind the header should never be able to.
            className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
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
                {isSyntax
                  ? "Press Enter to run this search on Scryfall."
                  : loading
                    ? "Searching…"
                    : `No card name matches “${term}”. Press Enter to search all cards.`}
              </p>
            ) : (
              <ul className="max-h-[min(24rem,calc(100dvh-6rem))] overflow-y-auto py-1">
                {results.map((card, index) => (
                  <li key={card.sample_card_id ?? card.name}>
                    <button
                      type="button"
                      id={`header-search-option-${index}`}
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
                        <span className="mt-0.5 block truncate text-xs text-accent-text">
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

            {term ? (
              <button
                type="button"
                onClick={submitQuery}
                className="flex w-full items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-surface-muted coarse:min-h-11"
              >
                <span className="truncate">Search all cards for &ldquo;{term}&rdquo;</span>
                <ArrowRightIcon className="size-4 shrink-0" />
              </button>
            ) : null}

            <a
              href="https://scryfall.com/docs/syntax"
              target="_blank"
              rel="noreferrer"
              className="block border-t border-border px-3 py-2 text-xs text-ink-muted hover:bg-surface-muted"
            >
              Syntax help
            </a>

            <Link
              href={advancedHref}
              onClick={() => setDropdownOpen(false)}
              className="flex w-full items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium text-accent-text transition-colors hover:bg-surface-muted coarse:min-h-11"
            >
              <span>Advanced Search</span>
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        ) : null}
      </div>

      {/* Below lg the field would not fit, so the destination is offered
          directly — Advanced Search, the same place the icon inside the
          desktop field now goes, not /find (a different "where is my card,
          among the people I know?" feature that this icon must not be
          conflated with). */}
      <Link
        href={advancedHref}
        aria-label="Advanced Search"
        title="Advanced Search"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink coarse:size-11 lg:hidden"
      >
        <SearchIcon className="size-4" />
      </Link>
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

function ArrowRightIcon({ className }: { className?: string }) {
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
      <path d="m7.5 5 5 5-5 5" />
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
