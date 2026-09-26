"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  MAX_QUERY_CODEPOINTS,
  builderToQuery,
  specToParams,
  type BuilderModel,
  type BuilderRow,
  type SearchSpec,
} from "@upkeep/domain";

import { ManaSymbol } from "@/components/ManaCost";
import { Button, Input, Select, cx } from "@/components/ui";

/**
 * `/search`'s editor. The raw box is the source of truth: Enter (or Search)
 * submits exactly what is in it. The builder only *generates* ordinary
 * Scryfall text and shows it read-only; it never parses or clears the raw box,
 * so a regex, a nested OR or an operator the builder knows nothing about
 * survives opening and using it. "Use this" swaps the box's text for the
 * generated query; "Add" appends to it.
 */
export function CatalogSearchForm({ spec }: { spec: SearchSpec }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [raw, setRaw] = useState(spec.q);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [model, setModel] = useState<BuilderModel>({});

  const tooLong = Array.from(raw).length > MAX_QUERY_CODEPOINTS;
  const preview = builderToQuery(model);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const q = raw.trim();
    if (q === "") return void startTransition(() => router.push("/search"));
    if (tooLong) return;
    startTransition(() => router.push(`/search?${specToParams({ ...spec, q, page: 1 })}`));
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-1" role="search">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="catalog-q">Search cards with Scryfall syntax</label>
          <Input
            id="catalog-q"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="t:legendary (t:elf or t:goblin) — or paste any Scryfall search"
            aria-invalid={tooLong}
            aria-describedby="catalog-q-help"
            className="py-3 pl-4 text-base"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" className="shrink-0 px-6 py-3 text-base" disabled={pending || tooLong}>
            {pending ? "Searching…" : "Search"}
          </Button>
        </div>
        <p id="catalog-q-help" className={cx("text-xs", tooLong ? "text-danger-text" : "text-ink-muted")} role={tooLong ? "alert" : undefined}>
          {tooLong
            ? `That's ${Array.from(raw).length} characters; the limit is ${MAX_QUERY_CODEPOINTS}.`
            : <>Runs on Scryfall exactly as typed. <a className="underline" href="https://scryfall.com/docs/syntax" target="_blank" rel="noreferrer">Syntax help</a>. Scryfall&rsquo;s website-only extras (spelling help, set galleries, widening an empty search) aren&rsquo;t included.</>}
        </p>
      </form>

      <div className="overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setBuilderOpen((v) => !v)}
          aria-expanded={builderOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-surface-muted"
        >
          <span>Query builder</span>
          <Chevron open={builderOpen} />
        </button>

        {builderOpen ? (
          <div className="border-t border-border bg-surface-raised">
            {/* The result comes first, so it never scrolls out of reach. */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3">
              <output
                aria-label="Generated query"
                className={cx(
                  "min-w-0 flex-1 break-words font-mono text-sm",
                  preview ? "text-ink" : "text-ink-muted",
                )}
              >
                {preview || "Pick options below to build a query."}
              </output>
              <div className="flex shrink-0 gap-2">
                <Button type="button" disabled={!preview} onClick={() => setRaw(preview)} className="px-3 py-1.5 text-xs">
                  Use this
                </Button>
                <Button type="button" variant="secondary" disabled={!preview} onClick={() => setRaw((r) => `${r.trim()} ${preview}`.trim())} className="px-3 py-1.5 text-xs">
                  Add to search
                </Button>
                <Button type="button" variant="secondary" onClick={() => setModel({})} className="px-3 py-1.5 text-xs">
                  Reset
                </Button>
              </div>
            </div>
            <Builder model={model} onChange={setModel} />
            <div className="border-t border-border px-4 py-2 text-right text-xs">
              <Link href="/search" className="text-ink-muted hover:underline">Start a new search</Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const LETTERS = ["W", "U", "B", "R", "G"] as const;
const COLOR_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };
const COLOR_MODES = [["includes", "Includes"], ["exact", "Exactly"], ["atMost", "At most"]] as const;
const STAT_FIELDS = [["mv", "Mana value"], ["pow", "Power"], ["tou", "Toughness"], ["loy", "Loyalty"], ["pt", "Total P+T"]] as const;
const OPS = [":", "=", "!=", ">", ">=", "<", "<="];
const GAMES = ["paper", "arena", "mtgo"];
const FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper", "historic", "brawl", "oathbreaker", "premodern", "oldschool"];
const RARITIES = [["common", "Common"], ["uncommon", "Uncommon"], ["rare", "Rare"], ["mythic", "Mythic"], ["special", "Special"], ["bonus", "Bonus"]] as const;
const PRICE_FIELDS = ["usd", "eur", "tix"];
const UNIQUES = [["", "Cards"], ["prints", "All prints"], ["art", "Unique art"]] as const;
const DISPLAYS = ["grid", "checklist", "full", "text"] as const;
const ORDERS = ["name", "released", "set", "rarity", "color", "usd", "eur", "tix", "cmc", "power", "toughness", "edhrec", "penny", "artist", "review"];
const PREFERS = ["oldest", "newest", "usd-low", "usd-high", "eur-low", "eur-high", "tix-low", "tix-high", "promo", "default", "atypical", "ub", "notub", "best"];
const LANGS = ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "ru", "zhs", "zht"];

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const toggle = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cx("size-4 transition-transform", open && "rotate-180")}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A titled group. Rarely-used groups start collapsed so the form stays short. */
function Section({ title, children, defaultOpen = true, summary }: { title: string; children: React.ReactNode; defaultOpen?: boolean; summary?: string }) {
  return (
    <details open={defaultOpen} className="group border-b border-border last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        <span>{title}{summary ? <span className="ml-2 font-normal normal-case tracking-normal text-accent-text">{summary}</span> : null}</span>
        <span className="transition-transform group-open:rotate-180"><Chevron open={false} /></span>
      </summary>
      <div className="space-y-3 px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[7.5rem_1fr]">
      <span className="text-sm text-ink-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A pressable pill; `on` shows selection with the accent, never colour alone (aria-pressed too). */
function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors coarse:min-h-11",
        on ? "border-accent-text bg-accent-soft font-medium text-ink" : "border-border-strong text-ink-muted hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}

/** Mana pips as toggles: the symbol is the label, dimmed until chosen. */
function Pips({ letters, selected, onToggle, colorless }: { letters: readonly string[]; selected: string[]; onToggle: (l: string) => void; colorless?: { on: boolean; toggle: () => void } }) {
  const pip = (code: string, on: boolean, click: () => void) => (
    <button
      key={code}
      type="button"
      aria-pressed={on}
      aria-label={COLOR_NAMES[code]}
      title={COLOR_NAMES[code]}
      onClick={click}
      className={cx(
        "grid size-9 place-items-center rounded-full border-2 transition coarse:size-11",
        on ? "border-accent-text bg-accent-soft" : "border-transparent opacity-45 hover:opacity-100",
      )}
    >
      <ManaSymbol code={code} />
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {letters.map((l) => pip(l, selected.includes(l), () => onToggle(l)))}
      {colorless ? pip("C", colorless.on, colorless.toggle) : null}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-border-strong text-sm">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cx("px-3 py-1.5 coarse:min-h-11", value === v ? "bg-accent-soft font-medium text-ink" : "text-ink-muted hover:bg-surface-muted")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function TextWithMode({ label, value, mode, placeholder, onValue, onMode, extra }: {
  label: string; value: string; mode: "phrase" | "words"; placeholder?: string;
  onValue: (v: string) => void; onMode: (m: "phrase" | "words") => void; extra?: React.ReactNode;
}) {
  return (
    <Row label={label}>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label={label} value={value} onChange={(e) => onValue(e.target.value)} placeholder={placeholder} className="min-w-40 flex-1" />
        <Segmented<"words" | "phrase"> label={`${label} matching`} value={mode} onChange={onMode} options={[["words", "Words"], ["phrase", "Phrase"]]} />
        {extra}
      </div>
    </Row>
  );
}

function Builder({ model, onChange }: { model: BuilderModel; onChange: (m: BuilderModel) => void }) {
  const patch = (p: Partial<BuilderModel>) => onChange({ ...model, ...p });

  const name = model.name ?? { value: "", mode: "words" as const };
  const oracle = model.oracle ?? { value: "", mode: "words" as const };
  const colors = model.colors ?? { letters: [], mode: "includes" as const };
  const identity = model.identity ?? { letters: [], mode: "atMost" as const };
  const types = model.types ?? { include: [], exclude: [] };
  const flavor = model.flavor ?? { value: "", mode: "words" as const };
  const lore = model.lore ?? { value: "", mode: "words" as const };

  const editRows = (list: BuilderRow[] | undefined, fields: readonly (string | readonly [string, string])[], set: (r: BuilderRow[]) => void, valuePlaceholder: string) => {
    const opts = fields.map((f) => (typeof f === "string" ? [f, f] : f) as readonly [string, string]);
    const update = (i: number, p: Partial<BuilderRow>) => set((list ?? []).map((x, j) => (j === i ? { ...x, ...p } : x)));
    return (
      <div className="space-y-2">
        {(list ?? []).map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select aria-label="Field" value={r.field} onChange={(e) => update(i, { field: e.target.value })} className="w-auto!">{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <Select aria-label="Comparison" value={r.op} onChange={(e) => update(i, { op: e.target.value })} className="w-20!">{OPS.map((o) => <option key={o}>{o}</option>)}</Select>
            <Input aria-label="Value" value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder={valuePlaceholder} className="w-28!" />
            <button type="button" aria-label="Remove row" onClick={() => set((list ?? []).filter((_, j) => j !== i))} className="rounded px-2 text-lg text-ink-muted hover:text-ink">×</button>
          </div>
        ))}
        <button type="button" onClick={() => set([...(list ?? []), { field: opts[0]![0], op: ">=", value: "" }])} className="text-sm text-accent-text hover:underline">
          + Add condition
        </button>
      </div>
    );
  };

  const colorSummary = colors.colorless ? "Colorless" : colors.letters.length ? `${COLOR_MODES.find((m) => m[0] === colors.mode)?.[1]} ${colors.letters.join("")}` : undefined;

  return (
    <div>
      <Section title="Card">
        <Row label="Name">
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Card name" value={name.value} onChange={(e) => patch({ name: { ...name, value: e.target.value } })} placeholder="Sol Ring" className="min-w-40 flex-1" />
            <Chip on={!!name.exact} onClick={() => patch({ name: { ...name, exact: !name.exact } })}>Exact name</Chip>
          </div>
        </Row>
        <TextWithMode
          label="Rules text" value={oracle.value} mode={oracle.mode} placeholder="draw a card"
          onValue={(v) => patch({ oracle: { ...oracle, value: v } })} onMode={(m) => patch({ oracle: { ...oracle, mode: m } })}
          extra={<Chip on={!!oracle.full} onClick={() => patch({ oracle: { ...oracle, full: !oracle.full } })}>With reminder text</Chip>}
        />
        <Row label="Types">
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Types" value={types.include.join(", ")} onChange={(e) => patch({ types: { ...types, include: csv(e.target.value) } })} placeholder="legendary, elf" className="min-w-40 flex-1" />
            <Chip on={!!types.anyOf} onClick={() => patch({ types: { ...types, anyOf: !types.anyOf } })}>Any of these</Chip>
          </div>
        </Row>
        <Row label="Not types">
          <Input aria-label="Excluded types" value={types.exclude.join(", ")} onChange={(e) => patch({ types: { ...types, exclude: csv(e.target.value) } })} placeholder="artifact" />
        </Row>
      </Section>

      <Section title="Color" summary={colorSummary}>
        <Row label="Card colors">
          <div className="flex flex-wrap items-center gap-3">
            <Pips
              letters={LETTERS} selected={colors.letters}
              onToggle={(l) => patch({ colors: { ...colors, colorless: false, letters: toggle(colors.letters, l) } })}
              colorless={{ on: !!colors.colorless, toggle: () => patch({ colors: { ...colors, letters: [], colorless: !colors.colorless } }) }}
            />
            <Segmented label="Color matching" value={colors.mode} options={COLOR_MODES} onChange={(m) => patch({ colors: { ...colors, mode: m } })} />
          </div>
        </Row>
        <Row label="Commander identity">
          <div className="flex flex-wrap items-center gap-3">
            <Pips letters={LETTERS} selected={identity.letters} onToggle={(l) => patch({ identity: { ...identity, letters: toggle(identity.letters, l) } })} />
            <Segmented label="Identity matching" value={identity.mode} options={COLOR_MODES} onChange={(m) => patch({ identity: { ...identity, mode: m } })} />
          </div>
        </Row>
      </Section>

      <Section title="Cost & stats">
        <Row label="Mana cost">
          <Input aria-label="Mana cost" value={model.manaCost?.value ?? ""} onChange={(e) => patch({ manaCost: { ...model.manaCost, value: e.target.value } })} placeholder="{2}{G}" className="w-40!" />
        </Row>
        <Row label="Stats">{editRows(model.stats, STAT_FIELDS, (r) => patch({ stats: r }), "3")}</Row>
      </Section>

      <Section title="Printing">
        <Row label="Rarity">
          <div className="flex flex-wrap gap-1.5">
            {RARITIES.map(([v, l]) => <Chip key={v} on={!!model.rarities?.includes(v)} onClick={() => patch({ rarities: toggle(model.rarities, v) })}>{l}</Chip>)}
          </div>
        </Row>
        <Row label="Sets">
          <Input aria-label="Sets" value={(model.sets ?? []).join(", ")} onChange={(e) => patch({ sets: csv(e.target.value) })} placeholder="lea, leb — any of" />
        </Row>
        <Row label="Games">
          <div className="flex flex-wrap gap-1.5">
            {GAMES.map((g) => <Chip key={g} on={!!model.games?.includes(g)} onClick={() => patch({ games: toggle(model.games, g) })}><span className="capitalize">{g}</span></Chip>)}
          </div>
        </Row>
        <Row label="Language">
          <Select aria-label="Language" value={model.language ?? ""} onChange={(e) => patch({ language: e.target.value || undefined })} className="w-auto!">
            <option value="">Default</option><option value="any">Any language</option>
            {LANGS.map((l) => <option key={l}>{l}</option>)}
          </Select>
        </Row>
      </Section>

      <Section title="Legality & price" defaultOpen={false}>
        <Row label="Formats">
          <div className="space-y-2">
            {(model.formats ?? []).map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select aria-label="Status" value={f.status} onChange={(e) => patch({ formats: (model.formats ?? []).map((x, j) => (j === i ? { ...x, status: e.target.value as typeof f.status } : x)) })} className="w-auto!"><option value="legal">Legal in</option><option value="banned">Banned in</option><option value="restricted">Restricted in</option></Select>
                <Select aria-label="Format" value={f.format} onChange={(e) => patch({ formats: (model.formats ?? []).map((x, j) => (j === i ? { ...x, format: e.target.value } : x)) })} className="w-auto!">{FORMATS.map((x) => <option key={x}>{x}</option>)}</Select>
                <button type="button" aria-label="Remove format" onClick={() => patch({ formats: (model.formats ?? []).filter((_, j) => j !== i) })} className="rounded px-2 text-lg text-ink-muted hover:text-ink">×</button>
              </div>
            ))}
            <button type="button" onClick={() => patch({ formats: [...(model.formats ?? []), { status: "legal", format: "commander" }] })} className="text-sm text-accent-text hover:underline">+ Add format</button>
          </div>
        </Row>
        <Row label="Price">{editRows(model.prices, PRICE_FIELDS, (r) => patch({ prices: r }), "5.00")}</Row>
      </Section>

      <Section title="Art & flavor" defaultOpen={false}>
        <Row label="Artist"><Input aria-label="Artist" value={model.artist ?? ""} onChange={(e) => patch({ artist: e.target.value })} placeholder="John Avon" /></Row>
        <TextWithMode label="Flavor text" value={flavor.value} mode={flavor.mode} onValue={(v) => patch({ flavor: { ...flavor, value: v } })} onMode={(m) => patch({ flavor: { ...flavor, mode: m } })} />
        <TextWithMode label="Lore" value={lore.value} mode={lore.mode} placeholder="urza" onValue={(v) => patch({ lore: { ...lore, value: v } })} onMode={(m) => patch({ lore: { ...lore, mode: m } })} />
      </Section>

      <Section title="Results" defaultOpen={false}>
        <Row label="Show">
          <Segmented label="Rollup" value={(model.unique ?? "") as string} options={UNIQUES} onChange={(v) => patch({ unique: (v || undefined) as BuilderModel["unique"] })} />
        </Row>
        <Row label="View">
          <Segmented label="View" value={model.display ?? "grid"} options={DISPLAYS.map((d) => [d, d[0]!.toUpperCase() + d.slice(1)] as const)} onChange={(v) => patch({ display: v === "grid" ? undefined : v })} />
        </Row>
        <Row label="Sort">
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Sort" value={model.order ?? ""} onChange={(e) => patch({ order: e.target.value || undefined })} className="w-auto!"><option value="">Default order</option>{ORDERS.map((o) => <option key={o}>{o}</option>)}</Select>
            <Select aria-label="Direction" value={model.direction ?? ""} onChange={(e) => patch({ direction: (e.target.value || undefined) as BuilderModel["direction"] })} className="w-auto!"><option value="">Auto</option><option value="asc">Ascending</option><option value="desc">Descending</option></Select>
          </div>
        </Row>
        <Row label="Printing">
          <Select aria-label="Printing preference" value={model.prefer ?? ""} onChange={(e) => patch({ prefer: e.target.value || undefined })} className="w-auto!"><option value="">Default</option>{PREFERS.map((o) => <option key={o}>{o}</option>)}</Select>
        </Row>
      </Section>
    </div>
  );
}
