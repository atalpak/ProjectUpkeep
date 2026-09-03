"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MIN_TERM, type LocatedCard } from "@/lib/collection/locate";
import { useCardPanel } from "@/components/CardPanel";
import { cx } from "@/components/ui";

/**
 * Search every card, from the chrome.
 *
 * Type a name and the dropdown fills with matches from all of Magic (the local
 * `cards` mirror, so it stays fast and offline). A card you own carries a
 * lighter line saying how many and where. Picking one opens the card popup —
 * full detail, a printing switcher, and add-to-collection / add-to-deck — over
 * whatever page you were on, owned or not.
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
};

type Result = CardHit & { owned: LocatedCard | null };

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

  const term = value.trim();

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
  // never land after a newer one.
  useEffect(() => {
    if (term.length < MIN_TERM) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const [cardsRes, mineRes] = await Promise.all([
          fetch(`/api/cards/search?q=${encodeURIComponent(term)}`, { signal: controller.signal }),
          fetch(`/api/collection/locate?q=${encodeURIComponent(term)}`, { signal: controller.signal }),
        ]);
        if (!cardsRes.ok) return;

        const cards = ((await cardsRes.json()).results ?? []) as CardHit[];
        const mine = mineRes.ok
          ? (((await mineRes.json()).results ?? []) as LocatedCard[])
          : [];
        const ownedByName = new Map(mine.map((c) => [c.name.toLowerCase(), c]));

        setResults(
          cards.map((c) => ({ ...c, owned: ownedByName.get(c.name.toLowerCase()) ?? null })),
        );
        setActive(-1);
        setDropdownOpen(true);
      } catch {
        // Aborted, or offline. The field still works as a way to reach /find.
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  function pick(result: Result) {
    if (!result.sample_card_id) return;
    setDropdownOpen(false);
    input.current?.blur();
    open(result.sample_card_id);
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
        router.push(`/find?q=${encodeURIComponent(term)}`);
      }
    }
  }

  return (
    <>
      <div ref={container} className="relative hidden lg:block">
        <label className="relative block">
          <span className="sr-only">Search all cards</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            ref={input}
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              if (next.trim().length < MIN_TERM) {
                setResults([]);
                setDropdownOpen(false);
              }
            }}
            onFocus={() => {
              if (results.length > 0) setDropdownOpen(true);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search cards…"
            role="combobox"
            aria-expanded={dropdownOpen}
            aria-controls="header-search-results"
            aria-autocomplete="list"
            className="w-48 rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-sm placeholder:text-ink-muted"
          />
        </label>

        {dropdownOpen ? (
          <div
            id="header-search-results"
            role="listbox"
            className="absolute right-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
          >
            {results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-ink-muted">
                {loading ? "Searching…" : `No card matches “${term}”.`}
              </p>
            ) : (
              <>
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
                      </button>
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/find?q=${encodeURIComponent(term)}`}
                  onClick={() => {
                    setDropdownOpen(false);
                    setValue("");
                  }}
                  className="block border-t border-border px-3 py-2 text-xs text-accent hover:bg-surface-muted"
                >
                  Open in the card finder
                </Link>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* Below lg the field would not fit, so the destination is offered directly. */}
      <Link
        href="/find"
        aria-label="Find a card"
        title="Find a card"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink lg:hidden"
      >
        <SearchIcon className="size-4" />
      </Link>
    </>
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
