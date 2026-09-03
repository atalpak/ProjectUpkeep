"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  COLORS,
  COLOR_LABELS,
  COLOR_MODES,
  COLOR_MODE_LABELS,
  EMPTY_FILTER,
  NUMERIC_OPS,
  NUMERIC_OP_LABELS,
  RARITIES,
  UNSORTED,
  activeFilterCount,
  filterToParams,
  type Color,
  type CollectionFilter,
  type NumericFilter,
} from "@/lib/collection/filters";
import { Button, Field, Input, Select, cx } from "@/components/ui";
import { ManaSymbol } from "@/components/ManaCost";
import { groupLocationsByType } from "@/components/LocationSelect";
import {
  CONDITIONS,
  CONDITION_LABELS,
  FINISHES,
  FINISH_LABELS,
  LANGUAGES,
  LOCATION_TYPE_LABELS,
  type Location,
} from "@/lib/types";

/**
 * Advanced search over the collection.
 *
 * Modelled on Moxfield's panel, minus three of its rows: price (the charter
 * excludes pricing outright), alterations and playtest cards (Scryfall has both,
 * we do not sync either, and a filter that silently matches nothing is worse
 * than no filter).
 *
 * Applying navigates rather than setting state, so the criteria land in the URL
 * and a filtered view can be bookmarked, shared and survive a refresh.
 */
export function CollectionFilters({
  initial,
  locations,
  sets,
}: {
  initial: CollectionFilter;
  locations: Location[];
  sets: Array<{ code: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CollectionFilter>(initial);

  const activeCount = activeFilterCount(initial);
  const set = <K extends keyof CollectionFilter>(key: K, value: CollectionFilter[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  function apply() {
    const params = filterToParams(draft);
    router.push(params.toString() ? `/collection?${params}` : "/collection");
    setOpen(false);
  }

  // The name box filters as you type. Only the name auto-applies — the advanced
  // panel still waits for Apply — and it replaces rather than pushes so a
  // search is one history entry, not one per keystroke.
  useEffect(() => {
    if (draft.name.trim() === initial.name.trim()) return;
    const timer = setTimeout(() => {
      const params = filterToParams({ ...initial, name: draft.name });
      router.replace(params.toString() ? `/collection?${params}` : "/collection");
    }, 300);
    return () => clearTimeout(timer);
  }, [draft.name, initial, router]);

  function clear() {
    setDraft(EMPTY_FILTER);
    router.push("/collection");
    setOpen(false);
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        {/* The name box stays outside the panel: it is what most searches are,
            and burying it behind a button would be a step backwards. */}
        <label className="min-w-48 flex-1 space-y-1">
          <span className="text-xs font-medium text-ink-muted">Search</span>
          <Input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
            placeholder="Card name"
          />
        </label>

        <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)}>
          Advanced{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>

        <Button type="button" onClick={apply}>
          Apply
        </Button>

        {activeCount > 0 ? (
          <Button type="button" variant="ghost" onClick={clear}>
            Clear
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-4 rounded-lg border border-border bg-surface-raised p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Set / Expansion">
              <Select value={draft.set} onChange={(e) => set("set", e.target.value)}>
                <option value="">Any set</option>
                {sets.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Rules text"
              hint={`For an exact phrase, put quotes (") around it.`}
            >
              <Input
                value={draft.oracle}
                onChange={(e) => set("oracle", e.target.value)}
                placeholder="draw a card"
              />
            </Field>

            <Field label="Card type">
              <Input
                value={draft.type}
                onChange={(e) => set("type", e.target.value)}
                placeholder="Creature — Goblin"
              />
            </Field>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-ink-muted">Colors</span>
            <div className="flex flex-wrap items-center gap-3">
              <ColorPicker
                selected={draft.colors}
                onChange={(colors) => set("colors", colors)}
                name="colors"
              />
              <Select
                value={draft.colorMode}
                onChange={(e) => set("colorMode", e.target.value as CollectionFilter["colorMode"])}
                className="w-56"
                aria-label="How to match colors"
              >
                {COLOR_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {COLOR_MODE_LABELS[mode]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-ink-muted">
              Color identity{" "}
              <span className="font-normal">— cards whose identity includes all of these</span>
            </span>
            <ColorPicker
              selected={draft.colorIdentity}
              onChange={(colors) => set("colorIdentity", colors)}
              name="ci"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumericField
              label="Mana value"
              value={draft.manaValue}
              onChange={(v) => set("manaValue", v)}
            />

            <Field label="Mana cost" hint="e.g. {2}{G} — matches costs containing these symbols.">
              <Input
                value={draft.manaCost}
                onChange={(e) => set("manaCost", e.target.value)}
                placeholder="{2}{G}"
              />
            </Field>

            <Field label="Rarity">
              <Select value={draft.rarity} onChange={(e) => set("rarity", e.target.value)}>
                <option value="">All</option>
                {RARITIES.map((r) => (
                  <option key={r} value={r} className="capitalize">
                    {r[0].toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>

            <NumericField label="Power" value={draft.power} onChange={(v) => set("power", v)} />
            <NumericField
              label="Toughness"
              value={draft.toughness}
              onChange={(v) => set("toughness", v)}
            />
            <NumericField
              label="Loyalty"
              value={draft.loyalty}
              onChange={(v) => set("loyalty", v)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Condition">
              <Select
                value={draft.condition}
                onChange={(e) =>
                  set("condition", e.target.value as CollectionFilter["condition"])
                }
              >
                <option value="">All</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Finish">
              <Select
                value={draft.finish}
                onChange={(e) => set("finish", e.target.value as CollectionFilter["finish"])}
              >
                <option value="">All</option>
                {FINISHES.map((f) => (
                  <option key={f} value={f}>
                    {FINISH_LABELS[f]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Language">
              <Select value={draft.language} onChange={(e) => set("language", e.target.value)}>
                <option value="">All</option>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Location">
              {/* Grouped like the destination pickers, but without their "New
                  location…" entry: this is a filter, and creating a container
                  from it would file nothing anywhere. */}
              <Select value={draft.location} onChange={(e) => set("location", e.target.value)}>
                <option value="">Everywhere</option>
                <option value={UNSORTED}>Unsorted</option>
                {groupLocationsByType(locations).map((group) => (
                  <optgroup key={group.type} label={LOCATION_TYPE_LABELS[group.type]}>
                    {group.items.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex gap-2 border-t border-border pt-3">
            <Button type="button" onClick={apply}>
              Apply filters
            </Button>
            <Button type="button" variant="secondary" onClick={clear}>
              Clear all
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ColorPicker({
  selected,
  onChange,
  name,
}: {
  selected: Color[];
  onChange: (colors: Color[]) => void;
  name: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLORS.map((color) => {
        const on = selected.includes(color);
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
              name={`${name}-${color}`}
              checked={on}
              onChange={() =>
                onChange(on ? selected.filter((c) => c !== color) : [...selected, color])
              }
              className="sr-only"
            />
            <ManaSymbol code={color} />
            <span className="sr-only">{COLOR_LABELS[color]}</span>
          </label>
        );
      })}
    </div>
  );
}

/** An operator plus a number, the shape Moxfield uses for every stat row. */
function NumericField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: NumericFilter;
  onChange: (value: NumericFilter) => void;
}) {
  const op = value?.op ?? "eq";
  const raw = value === null ? "" : String(value.value);

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <div className="flex gap-1.5">
        <Select
          value={op}
          onChange={(e) => {
            const nextOp = e.target.value as NonNullable<NumericFilter>["op"];
            // Changing the operator with no number yet is not a filter.
            if (value === null) return;
            onChange({ op: nextOp, value: value.value });
          }}
          aria-label={`${label} comparison`}
          className="w-32"
        >
          {NUMERIC_OPS.map((o) => (
            <option key={o} value={o}>
              {NUMERIC_OP_LABELS[o]}
            </option>
          ))}
        </Select>

        <Input
          type="number"
          value={raw}
          onChange={(e) => {
            const text = e.target.value;
            if (text.trim() === "") return onChange(null);
            const n = Number.parseFloat(text);
            onChange(Number.isFinite(n) ? { op, value: n } : null);
          }}
          aria-label={label}
          className="w-24"
        />
      </div>
    </div>
  );
}
