"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
import { Button, Field, Input, Select, cx } from "@/components/ui";
import { ManaSymbol } from "@/components/ManaCost";

/**
 * `/search`'s controls, in two tiers rather than one long form:
 *
 *   - A single box that speaks literal Scryfall syntax
 *     (scryfall.com/docs/syntax) — the primary way in, since this page's
 *     whole point is answering to that syntax the way Scryfall's own search
 *     does. Its own button is the only thing that submits it.
 *   - A collapsed-by-default "Filters" panel underneath, for the same facets
 *     built as fields (colour, mana value, type, rules text, set, rarity) —
 *     for someone who would rather click than remember `c:` from `t:`. Its
 *     header is one full-width clickable bar rather than a small toggle
 *     button, so there's no need to land a click on a specific word.
 *
 * The two are independent forms: submitting the raw box searches on it alone
 * (clearing any structured filter from the URL), and submitting the panel
 * searches on the structured fields alone. Whichever was used last is what
 * `/search`'s server component parses back out of the URL.
 */
export function AdvancedSearchForm({
  initial,
  initialRaw,
}: {
  initial: AdvancedCardFilter;
  initialRaw: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [raw, setRaw] = useState(initialRaw);
  const [filter, setFilter] = useState<AdvancedCardFilter>(initial);
  // Collapsed by default unless a structured filter is already active from
  // the URL (a shared link, or the back button) — otherwise the very filters
  // producing the results on screen would be hidden.
  const [filtersOpen, setFiltersOpen] = useState(
    () => initialRaw === "" && isAdvancedFilterActive(initial),
  );

  const set = <K extends keyof AdvancedCardFilter>(key: K, value: AdvancedCardFilter[K]) =>
    setFilter((prev) => ({ ...prev, [key]: value }));

  function submitRaw(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = raw.trim();
    startTransition(() => {
      router.push(trimmed ? `/search?raw=${encodeURIComponent(trimmed)}` : "/search");
    });
  }

  function submitFilters(event: React.FormEvent) {
    event.preventDefault();
    setRaw("");
    const params = advancedFilterToParams(filter);
    startTransition(() => {
      router.push(params.toString() ? `/search?${params}` : "/search");
    });
  }

  function clearFilters() {
    setFilter(EMPTY_ADVANCED_FILTER);
    if (raw.trim() === "") startTransition(() => router.push("/search"));
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submitRaw} className="relative">
        <Input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="c:r cmc<=2 t:creature — or paste any Scryfall search"
          aria-label="Search with Scryfall syntax"
          className="py-3 pl-4 pr-12 text-base"
        />
        <button
          type="submit"
          aria-label="Search"
          className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          {pending ? <Spinner className="size-5" /> : <SearchIcon className="size-5" />}
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-surface-muted"
        >
          <span>
            Filters
            {isAdvancedFilterActive(filter) && raw.trim() === "" ? " (active)" : ""}
          </span>
          <ChevronIcon className={cx("size-4 shrink-0 transition-transform", filtersOpen && "rotate-180")} />
        </button>

        {filtersOpen ? (
          <form
            onSubmit={submitFilters}
            className="space-y-4 border-t border-border bg-surface-raised p-4"
          >
            <Field label="Card name">
              <Input
                value={filter.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Sol Ring"
              />
            </Field>

            <div className="space-y-2">
              <span className="text-xs font-medium text-ink-muted">Colors</span>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {COLORS.map((color) => {
                    const on = filter.colors.includes(color);
                    return (
                      <label
                        key={color}
                        title={COLOR_LABELS[color]}
                        className={cx(
                          "flex cursor-pointer items-center justify-center rounded-md border p-1.5 transition-colors",
                          on
                            ? "border-accent bg-accent-soft ring-1 ring-accent"
                            : "border-border opacity-60 hover:bg-surface-muted hover:opacity-100",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            set(
                              "colors",
                              on ? filter.colors.filter((c) => c !== color) : [...filter.colors, color],
                            )
                          }
                          className="sr-only"
                        />
                        <ManaSymbol code={color} />
                        <span className="sr-only">{COLOR_LABELS[color]}</span>
                      </label>
                    );
                  })}
                </div>
                <Select
                  value={filter.colorMode}
                  onChange={(e) => set("colorMode", e.target.value as AdvancedCardFilter["colorMode"])}
                  aria-label="How to match colors"
                  className="w-auto"
                >
                  {COLOR_MODES.filter((m) => m !== "any").map((mode) => (
                    <option key={mode} value={mode}>
                      {COLOR_MODE_LABELS[mode]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Mana value">
                <div className="flex gap-1.5">
                  <Select
                    value={filter.cmc?.op ?? "eq"}
                    onChange={(e) => {
                      const op = e.target.value as NonNullable<NumericFilter>["op"];
                      if (filter.cmc === null) return;
                      set("cmc", { op, value: filter.cmc.value });
                    }}
                    className="w-28"
                  >
                    {NUMERIC_OPS.map((op) => (
                      <option key={op} value={op}>
                        {NUMERIC_OP_LABELS[op]}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    value={filter.cmc === null ? "" : String(filter.cmc.value)}
                    onChange={(e) => {
                      const text = e.target.value;
                      if (text.trim() === "") return set("cmc", null);
                      const n = Number.parseFloat(text);
                      set("cmc", Number.isFinite(n) ? { op: filter.cmc?.op ?? "eq", value: n } : null);
                    }}
                    className="w-24"
                  />
                </div>
              </Field>

              <Field label="Rarity">
                <Select value={filter.rarity} onChange={(e) => set("rarity", e.target.value)}>
                  <option value="">Any</option>
                  {RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {r[0].toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Set">
                <Input
                  value={filter.set}
                  onChange={(e) => set("set", e.target.value)}
                  placeholder="znr"
                />
              </Field>

              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Type line">
                  <Input
                    value={filter.type}
                    onChange={(e) => set("type", e.target.value)}
                    placeholder="Creature — Goblin"
                  />
                </Field>
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Rules text">
                  <Input
                    value={filter.oracle}
                    onChange={(e) => set("oracle", e.target.value)}
                    placeholder="draw a card"
                  />
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Clear
              </Button>
              <Button type="submit">Search</Button>
            </div>
          </form>
        ) : null}
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

function Spinner({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={cx("animate-spin", className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
