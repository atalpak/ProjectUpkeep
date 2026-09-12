"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  type AdvancedCardFilter,
} from "@/lib/cards/search-query";
import { Button, Field, Input, Select, cx } from "@/components/ui";
import { ManaSymbol } from "@/components/ManaCost";

/**
 * The structured facets behind `/search`, shaped after Scryfall's own
 * advanced search page (https://scryfall.com/advanced): fill in what you
 * know, or paste literal syntax into the box at the bottom, then press
 * Search — nothing runs live as you type, because a query over the whole
 * card database (not just a collection) is not something to fire on every
 * keystroke.
 *
 * A near-duplicate of what used to be `HeaderSearch.tsx`'s inline
 * "Advanced Search" panel — that panel is gone; this page is where it lives
 * now, reachable from the dropdown's own link rather than expanding in place.
 */
export function AdvancedSearchForm({
  initial,
  initialRaw,
}: {
  initial: AdvancedCardFilter;
  initialRaw: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<AdvancedCardFilter>(initial);
  const [raw, setRaw] = useState(initialRaw);

  const set = <K extends keyof AdvancedCardFilter>(key: K, value: AdvancedCardFilter[K]) =>
    setFilter((prev) => ({ ...prev, [key]: value }));

  const rawActive = raw.trim() !== "";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // The raw box speaks for the whole search when it has anything in it —
    // same rule the route and the header dropdown apply — so it is the only
    // param sent rather than mixed with whatever the fields above still hold.
    const params = rawActive ? new URLSearchParams({ raw: raw.trim() }) : advancedFilterToParams(filter);
    router.push(params.toString() ? `/search?${params}` : "/search");
  }

  function clear() {
    setFilter(EMPTY_ADVANCED_FILTER);
    setRaw("");
    router.push("/search");
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-surface-raised p-4">
      <Field label="Card name">
        <Input
          value={filter.name}
          disabled={rawActive}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Sol Ring"
          className="disabled:opacity-40"
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
            disabled={rawActive}
            onChange={(e) => set("colorMode", e.target.value as AdvancedCardFilter["colorMode"])}
            aria-label="How to match colors"
            className="w-auto disabled:opacity-40"
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
              disabled={rawActive}
              onChange={(e) => {
                const op = e.target.value as NonNullable<NumericFilter>["op"];
                if (filter.cmc === null) return;
                set("cmc", { op, value: filter.cmc.value });
              }}
              className="w-28 disabled:opacity-40"
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
              disabled={rawActive}
              onChange={(e) => {
                const text = e.target.value;
                if (text.trim() === "") return set("cmc", null);
                const n = Number.parseFloat(text);
                set("cmc", Number.isFinite(n) ? { op: filter.cmc?.op ?? "eq", value: n } : null);
              }}
              className="w-24 disabled:opacity-40"
            />
          </div>
        </Field>

        <Field label="Rarity">
          <Select
            value={filter.rarity}
            disabled={rawActive}
            onChange={(e) => set("rarity", e.target.value)}
            className="disabled:opacity-40"
          >
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
            disabled={rawActive}
            onChange={(e) => set("set", e.target.value)}
            placeholder="znr"
            className="disabled:opacity-40"
          />
        </Field>

        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Type line">
            <Input
              value={filter.type}
              disabled={rawActive}
              onChange={(e) => set("type", e.target.value)}
              placeholder="Creature — Goblin"
              className="disabled:opacity-40"
            />
          </Field>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Rules text">
            <Input
              value={filter.oracle}
              disabled={rawActive}
              onChange={(e) => set("oracle", e.target.value)}
              placeholder="draw a card"
              className="disabled:opacity-40"
            />
          </Field>
        </div>
      </div>

      <Field
        label="Or paste Scryfall syntax"
        hint="Takes over from the fields above — see scryfall.com/docs/syntax."
      >
        <Input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="c:r cmc<=2 t:creature"
          className={cx(rawActive && "border-accent")}
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={clear}>
          Clear
        </Button>
        <Button type="submit">Search</Button>
      </div>
    </form>
  );
}
