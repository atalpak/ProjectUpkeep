"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

import {
  DISPLAY_MODES,
  readPresentation,
  resolveDisplay,
  setDirective,
  specToParams,
  type CatalogCard,
  type DirectiveKey,
  type SearchSpec,
  type SearchSuccess,
} from "@upkeep/domain";

import { useCardPanel } from "@/components/CardPanel";
import { FlipButton, useCardFace } from "@/components/cards/FlipCard";
import { MagnifierTile, useTileSize } from "@/components/cards/SearchResultsGrid";
import { SizePicker, TILE_SIZES } from "@/components/cards/TileSizePicker";
import { ManaCost } from "@/components/ManaCost";
import { Badge, Banner, EmptyState, Select, cx } from "@/components/ui";
import { catalogCardToPanelCard } from "@/lib/cards/catalog-panel-card";
import type { OwnershipNote } from "@/lib/cards/search-enrichment-core";
import type { Card } from "@/lib/types";
import type { FriendNote } from "@/lib/social/queries";

/** Upstream serves up to 175 cards per page; one Upkeep page is one upstream page. */
const UPSTREAM_PAGE_SIZE = 175;

const UNIQUE_OPTIONS = [["cards", "Unique cards"], ["prints", "All prints"], ["art", "Unique art"]] as const;
const ORDER_OPTIONS = [
  "name", "released", "set", "rarity", "color", "usd", "eur", "tix", "cmc", "power", "toughness",
  "edhrec", "penny", "artist", "review",
] as const;
const PREFER_OPTIONS = [
  ["", "Default printing"], ["oldest", "Oldest"], ["newest", "Newest"], ["usd-low", "Cheapest (USD)"],
  ["usd-high", "Priciest (USD)"], ["eur-low", "Cheapest (EUR)"], ["promo", "Promo"], ["atypical", "Atypical"],
  ["ub", "Universes Beyond"], ["notub", "Not Universes Beyond"],
] as const;

export function CatalogResults({
  response,
  spec,
  ownership,
  friends,
  localIds,
  ownershipUnavailable,
}: {
  response: SearchSuccess;
  spec: SearchSpec;
  ownership: Record<string, OwnershipNote> | null;
  friends: Record<string, FriendNote[]> | null;
  /** Printings with a local catalog row; null = unknown (stay permissive). */
  localIds: string[] | null;
  ownershipUnavailable: boolean;
}) {
  const router = useRouter();
  const local = localIds ? new Set(localIds) : null;
  // A printing we hold locally opens by id, so the panel loads the full row (finishes, prices);
  // an upstream-only one opens from the search payload and is view-only.
  const toPanel = (c: CatalogCard): Card | string => (local?.has(c.id) ? c.id : catalogCardToPanelCard(c, local ? false : true));
  const inline = readPresentation(spec.q);
  const display = resolveDisplay(spec);

  const hrefFor = (next: SearchSpec) => `/search?${specToParams(next)}`;

  /** A control edits the query's own directive (adding one when absent) and returns to page 1. */
  function changeDirective(key: DirectiveKey, value: string | null) {
    const q = setDirective(spec.q, key, value);
    if (q === null) return;
    router.push(hrefFor({ ...spec, q, page: 1 }));
  }
  const locked = (key: DirectiveKey) => inline.duplicates.includes(key);

  const start = (response.page - 1) * UPSTREAM_PAGE_SIZE + 1;
  const end = start + response.cards.length - 1;

  return (
    <div className="space-y-4">
      <Banner kind="error">
        {response.warnings.length
          ? `Scryfall warned about this search, so results may not fully honour it: ${response.warnings.join(" ")}`
          : null}
      </Banner>
      {response.stale ? (
        <p role="status" className="text-sm text-ink-muted">
          Scryfall couldn&rsquo;t be reached, so these are saved results from {new Date(response.fetchedAt).toLocaleString()}.
        </p>
      ) : null}
      {ownershipUnavailable ? (
        <p className="text-xs text-ink-muted">Your collection notes are unavailable right now; results are complete.</p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <p role="status" aria-live="polite" className="mr-auto text-sm text-ink-muted">
          {response.cards.length === 0
            ? "No cards match."
            : response.totalCards !== null
              ? `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${response.totalCards.toLocaleString()}`
              : `Showing ${start.toLocaleString()}–${end.toLocaleString()}`}
        </p>
        <ControlSelect
          label="Rollup"
          disabled={locked("unique")}
          value={inline.unique === "prints" || inline.unique === "art" || inline.unique === "cards" ? inline.unique : (spec.unique ?? "cards")}
          onChange={(v) => changeDirective("unique", v === "cards" ? null : v)}
          options={UNIQUE_OPTIONS.map(([v, l]) => [v, l])}
        />
        <ControlSelect
          label="Sort"
          disabled={locked("order")}
          value={inline.order ?? spec.order ?? "name"}
          onChange={(v) => changeDirective("order", v === "name" ? null : v)}
          options={[
            ...(inline.order && !(ORDER_OPTIONS as readonly string[]).includes(inline.order) ? [[inline.order, inline.order]] : []),
            ...ORDER_OPTIONS.map((o) => [o, o[0]!.toUpperCase() + o.slice(1)]),
          ] as [string, string][]}
        />
        <ControlSelect
          label="Direction"
          disabled={locked("direction")}
          value={inline.direction ?? spec.dir ?? "auto"}
          onChange={(v) => changeDirective("direction", v === "auto" ? null : v)}
          options={[["auto", "Auto"], ["asc", "Ascending"], ["desc", "Descending"]]}
        />
        <ControlSelect
          label="Printing"
          disabled={locked("prefer")}
          value={inline.prefer ?? spec.prefer ?? ""}
          onChange={(v) => changeDirective("prefer", v === "" ? null : v)}
          options={PREFER_OPTIONS.map(([v, l]) => [v, l])}
        />
        <div role="group" aria-label="View" className="flex overflow-hidden rounded-md border border-border-strong text-sm">
          {DISPLAY_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={display === mode}
              onClick={() =>
                inline.display
                  ? changeDirective("display", mode === "grid" ? null : mode)
                  : router.push(hrefFor({ ...spec, display: mode === "grid" ? undefined : mode }))
              }
              className={cx("px-3 py-1.5 capitalize", display === mode ? "bg-accent-text text-inverse" : "hover:bg-surface-muted")}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {response.cards.length === 0 ? (
        <div className="space-y-2">
          <EmptyState title="Nothing matches that search." icon={false} />
          <EmptyHelp spec={spec} hrefFor={hrefFor} />
        </div>
      ) : display === "grid" ? (
        <GridView cards={response.cards} ownership={ownership} friends={friends} toPanel={toPanel} />
      ) : display === "checklist" ? (
        <ChecklistView cards={response.cards} ownership={ownership} friends={friends} toPanel={toPanel} />
      ) : (
        <DetailView cards={response.cards} ownership={ownership} friends={friends} toPanel={toPanel} withImage={display === "full"} />
      )}

      <nav aria-label="Result pages" className="flex justify-between text-sm">
        {response.page > 1 ? (
          <Link className="text-accent-text hover:underline" href={hrefFor({ ...spec, page: response.page - 1 })}>← Previous</Link>
        ) : <span />}
        {response.hasMore && response.nextPage ? (
          <Link className="text-accent-text hover:underline" href={hrefFor({ ...spec, page: response.nextPage })}>Next →</Link>
        ) : null}
      </nav>
    </div>
  );
}

function ControlSelect({
  label, value, onChange, options, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void; options: (readonly [string, string])[] | [string, string][]; disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
      {label}
      <Select
        value={value}
        disabled={disabled}
        title={disabled ? "Set more than once in the query — edit the query to change it." : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="py-1"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </label>
  );
}

const cardKey = (c: CatalogCard) => c.id;
const displayName = (c: CatalogCard) => c.printedName ?? c.flavorName ?? c.name;

function OwnedBadge({ note }: { note: OwnershipNote | undefined }) {
  if (!note) return null;
  if (note.exact > 0) return <Badge>You own {note.exact}</Badge>;
  return <Badge>You own another printing</Badge>;
}

type Friends = Record<string, FriendNote[]> | null;

function GridView({ cards, ownership, friends, toPanel }: { cards: CatalogCard[]; ownership: Record<string, OwnershipNote> | null; friends: Friends; toPanel: (c: CatalogCard) => Card | string }) {
  const [size, setSize] = useTileSize();
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><SizePicker size={size} onChange={setSize} /></div>
      <ul className="grid gap-5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_SIZES[size].minmax}, 1fr))` }}>
        {cards.map((c) => (
          <GridTile key={cardKey(c)} card={c} note={ownership?.[c.id]} friendNotes={friends?.[c.id]} panelCard={toPanel(c)} imageWidth={TILE_SIZES[size].imageWidth} />
        ))}
      </ul>
    </div>
  );
}

function GridTile({ card, note, friendNotes, panelCard, imageWidth }: { card: CatalogCard; note: OwnershipNote | undefined; friendNotes: FriendNote[] | undefined; panelCard: Card | string; imageWidth: string }) {
  const { open } = useCardPanel();
  const face = useCardFace(
    { name: card.name, flavor_name: card.flavorName ?? null, layout: card.layout, card_faces: catalogCardToPanelCard(card).card_faces, image_uri: card.imageLarge ?? card.imageNormal, image_uri_small: card.imageSmall },
    "normal",
  );
  return (
    <li className="relative">
      <MagnifierTile
        image={face.image ?? card.imageLarge ?? card.imageNormal}
        label={`${face.name ?? displayName(card)}, ${card.setName} ${card.collectorNumber}`}
        imageWidth={imageWidth}
        onClick={() => open(panelCard)}
        onImageError={face.onImageError}
        disabled={false}
      />
      {face.canFlip ? <FlipButton onFlip={face.flip} otherName={face.otherName} /> : null}
      {note ? <div className="mt-1 text-xs"><OwnedBadge note={note} /></div> : null}
      <FriendLine notes={friendNotes} />
    </li>
  );
}

function FriendLine({ notes }: { notes: FriendNote[] | undefined }) {
  if (!notes?.length) return null;
  const first = notes[0]!;
  const more = notes.length - 1;
  return (
    <span className="block truncate text-xs text-accent-text">
      {first.username} has {first.count}
      {first.samePrinting ? "" : " (another printing)"}
      {more > 0 ? ` +${more} more` : ""}
    </span>
  );
}

function priceOf(c: CatalogCard): string {
  return c.prices.usd ? `$${c.prices.usd}` : c.prices.eur ? `€${c.prices.eur}` : "—";
}

function ChecklistView({ cards, ownership, friends, toPanel }: { cards: CatalogCard[]; ownership: Record<string, OwnershipNote> | null; friends: Friends; toPanel: (c: CatalogCard) => Card | string }) {
  const { open } = useCardPanel();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Search results</caption>
        <thead className="text-xs text-ink-muted">
          <tr><th className="py-1 pr-3">Set</th><th className="pr-3">Name</th><th className="pr-3">Cost</th><th className="pr-3">Type</th><th className="pr-3">Rarity</th><th className="pr-3">Price</th><th /></tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={cardKey(c)} className="border-t border-border">
              <td className="py-1 pr-3 uppercase text-ink-muted">{c.set} {c.collectorNumber}</td>
              <td className="pr-3">
                <button type="button" className="text-left text-accent-text hover:underline" onClick={() => open(toPanel(c))}>{displayName(c)}</button>
              </td>
              <td className="pr-3"><ManaCost cost={c.manaCost ?? c.faces[0]?.manaCost} size="xs" /></td>
              <td className="pr-3">{c.typeLine ?? c.faces[0]?.typeLine}</td>
              <td className="pr-3 capitalize">{c.rarity}</td>
              <td className="pr-3">{priceOf(c)}</td>
              <td><OwnedBadge note={ownership?.[c.id]} /> <FriendLine notes={friends?.[c.id]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailView({ cards, ownership, friends, toPanel, withImage }: { cards: CatalogCard[]; ownership: Record<string, OwnershipNote> | null; friends: Friends; toPanel: (c: CatalogCard) => Card | string; withImage: boolean }) {
  const { open } = useCardPanel();
  return (
    <ul className={cx("grid gap-4", withImage ? "md:grid-cols-2" : "md:grid-cols-3")}>
      {cards.map((c) => {
        const faces = c.faces.length ? c.faces : [{ name: c.name, manaCost: c.manaCost, typeLine: c.typeLine, oracleText: c.oracleText } as CatalogCard["faces"][number]];
        return (
          <li key={cardKey(c)} className="flex gap-3 rounded-lg border border-border p-3">
            {withImage && c.imageNormal ? (
              <button type="button" onClick={() => open(toPanel(c))} className="relative aspect-[488/680] w-32 shrink-0 overflow-hidden rounded-md">
                <Image src={c.imageNormal} alt={displayName(c)} fill sizes="128px" className="object-cover" unoptimized />
              </button>
            ) : null}
            <div className="min-w-0 space-y-2 text-sm">
              {faces.map((f, i) => (
                <div key={i}>
                  <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => open(toPanel(c))}>{f.name}</button>{" "}
                  <ManaCost cost={f.manaCost} size="xs" />
                  <div className="text-ink-muted">{f.typeLine}</div>
                  {f.oracleText ? <p className="whitespace-pre-line">{f.oracleText}</p> : null}
                  {f.power ? <div>{f.power}/{f.toughness}</div> : null}
                  {withImage && f.flavorText ? <p className="italic text-ink-muted">{f.flavorText}</p> : null}
                  {withImage && f.artist ? <p className="text-xs text-ink-muted">Illustrated by {f.artist}</p> : null}
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <span className="uppercase">{c.set} {c.collectorNumber}</span><span>{priceOf(c)}</span>
                <OwnedBadge note={ownership?.[c.id]} />
                <FriendLine notes={friends?.[c.id]} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Offered, never applied silently: the searches Scryfall's website widens on
 * its own are one click here, each shown as the change it makes. A language
 * or extras choice already in the query is respected and not offered again.
 */
function EmptyHelp({ spec, hrefFor }: { spec: SearchSpec; hrefFor: (s: SearchSpec) => string }) {
  const options: { label: string; href: string }[] = [];
  if (spec.includeExtras !== true && !/\binclude:extras\b/i.test(spec.q)) {
    options.push({ label: "Include extras (tokens, art cards, oversized)", href: hrefFor({ ...spec, page: 1, includeExtras: true }) });
  }
  if (!/\b(lang|language):/i.test(spec.q) && spec.includeMultilingual !== true) {
    options.push({ label: "Search every language (lang:any)", href: hrefFor({ ...spec, page: 1, q: `${spec.q} lang:any` }) });
  }
  if (readPresentation(spec.q).unique === undefined && spec.unique === undefined) {
    options.push({ label: "Show all prints", href: hrefFor({ ...spec, page: 1, unique: "prints" }) });
  }
  if (options.length === 0) return null;
  return (
    <p className="text-center text-sm text-ink-muted">
      Try:{" "}
      {options.map((o, i) => (
        <span key={o.label}>
          {i > 0 ? " · " : ""}
          <Link className="text-accent-text hover:underline" href={o.href}>{o.label}</Link>
        </span>
      ))}
    </p>
  );
}
