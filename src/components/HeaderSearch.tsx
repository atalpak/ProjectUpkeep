"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MIN_TERM, type LocatedCard } from "@/lib/collection/locate";
import { UNSORTED } from "@/lib/collection/filters";
import { cx } from "@/components/ui";

/**
 * "Where is my card?", from anywhere.
 *
 * The product's whole premise is answering that question, and it was a nav tab
 * you had to travel to first. This puts it in the chrome and answers while you
 * type: the results say which binder, box or deck each match is sitting in, so
 * the common case never needs a page load at all.
 *
 * Below xl there is no room for the field, so the same thing is offered as an
 * icon that goes straight to /find.
 */

/** Long enough that a fast typist does not fire a request per character. */
const DEBOUNCE_MS = 180;

export function HeaderSearch() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);

  const [value, setValue] = useState("");
  const [results, setResults] = useState<LocatedCard[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
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
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Debounced lookup. The request is aborted when the query moves on, so a slow
  // response can never land after a newer one and overwrite it.
  useEffect(() => {
    if (term.length < MIN_TERM) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/collection/locate?q=${encodeURIComponent(term)}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { results: LocatedCard[]; total: number };
        setResults(body.results);
        setTotal(body.total ?? body.results.length);
        setActive(-1);
        setOpen(true);
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

  /** Where a given result should take you: straight to that shelf. */
  const hrefFor = (card: LocatedCard) => {
    const place = card.places[0];
    const query = `q=${encodeURIComponent(card.name)}`;
    if (!place) return `/collection?${query}`;
    const location = place.locationId ?? UNSORTED;
    return `/collection?location=${location}&${query}`;
  };

  function go(href: string) {
    setOpen(false);
    setValue("");
    input.current?.blur();
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setOpen(true);
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
      // A highlighted result wins; otherwise fall through to the full page,
      // which is the right home for "show me everything matching this".
      if (active >= 0 && results[active]) go(hrefFor(results[active]));
      else if (term) go(`/find?q=${encodeURIComponent(term)}`);
    }
  }

  return (
    <>
      <div ref={container} className="relative hidden xl:block">
        <label className="relative block">
          <span className="sr-only">Find a card in your collection</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            ref={input}
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              if (next.trim().length < MIN_TERM) {
                setResults([]);
                setOpen(false);
              }
            }}
            onFocus={() => {
              if (results.length > 0) setOpen(true);
            }}
            onKeyDown={onKeyDown}
            placeholder="Find a card…"
            role="combobox"
            aria-expanded={open}
            aria-controls="header-search-results"
            aria-autocomplete="list"
            // Fixed width, deliberately: growing on focus pushed the nav 12px
            // past its container and wrapped "Sign out" onto a second line. The
            // results panel below is wider than the field anyway, so there is
            // nothing to gain from the extra room.
            className="w-44 rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-sm placeholder:text-ink-muted"
          />
        </label>

        {open ? (
          <div
            id="header-search-results"
            role="listbox"
            className="absolute right-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
          >
            {results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-ink-muted">
                {loading ? "Searching…" : `Nothing in your collection matches “${term}”.`}
              </p>
            ) : (
              <>
                <ul className="max-h-96 overflow-y-auto py-1">
                  {results.map((card, index) => (
                    <li key={card.key}>
                      <Link
                        href={hrefFor(card)}
                        role="option"
                        aria-selected={index === active}
                        onClick={() => {
                          setOpen(false);
                          setValue("");
                        }}
                        onMouseEnter={() => setActive(index)}
                        className={cx(
                          "block px-3 py-2 text-sm transition-colors",
                          index === active ? "bg-surface-muted" : "hover:bg-surface-muted",
                        )}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium">{card.name}</span>
                          <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                            {card.total}
                          </span>
                        </span>
                        {/* The answer, not a link to the answer: which containers
                            these copies are actually in. */}
                        <span className="mt-0.5 block truncate text-xs text-ink-muted">
                          {card.places
                            .map((place) => `${place.name} ×${place.quantity}`)
                            .join(" · ")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/find?q=${encodeURIComponent(term)}`}
                  onClick={() => {
                    setOpen(false);
                    setValue("");
                  }}
                  className="block border-t border-border px-3 py-2 text-xs text-accent hover:bg-surface-muted"
                >
                  {total > results.length
                    ? `See all ${total} matches`
                    : "Open in the card finder"}
                </Link>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* Below xl the field would not fit, so the destination is offered
          directly. Same answer, one more tap. */}
      <Link
        href="/find"
        aria-label="Find a card in your collection"
        title="Find a card"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink xl:hidden"
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
