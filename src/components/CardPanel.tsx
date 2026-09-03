"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import type { Card, CardFace } from "@/lib/types";
import { languageLabel } from "@/lib/types";
import { useCardPreviewMode } from "@/components/CardPreviewMode";
import { ManaCost } from "@/components/ManaCost";
import { SetSymbol } from "@/components/SetSymbol";
import { Badge } from "@/components/ui";

/**
 * Card details, delivered three ways.
 *
 * One provider, one renderer, three presentations — chosen at interaction time
 * from the pointer, the viewport and the user's preference:
 *
 *   - `sidebar`  — the docked column on the right. Desktop default, xl+ only.
 *   - `tooltip`  — a floating panel that appears after a deliberate hover pause
 *                  and vanishes when the pointer leaves. Used when the reader
 *                  has switched the sidebar off, and on narrower desktop windows
 *                  where a docked column does not fit.
 *   - `sheet`    — a dialog, opened by tapping. Every touch device, regardless
 *                  of the preference: there is no hover to hang the other two on.
 *
 * Four pieces:
 *   - `CardPanelProvider`, which owns the active card and an in-memory cache;
 *   - `useCardPreview(card)`, which returns the handlers to spread onto any name
 *     or thumbnail — the only thing a list component needs to know about;
 *   - `CardDetails`, the shared renderer all three presentations use, so they
 *     can never drift apart;
 *   - `CardPanelOutlet`, which places the sidebar and mounts the other two.
 *
 * Two ways in, and which one a caller uses is the difference between a panel
 * that feels instant and one that does not:
 *
 *   - Hand over the card object. Every list built from a query that selected
 *     the card columns already holds everything this panel renders, so there is
 *     nothing to wait for and the panel fills on the same frame as the hover.
 *   - Hand over an id. Used where the caller genuinely has nothing else — the
 *     import preview, the printing picker. This costs a request, and behind it
 *     three sequential trips to Supabase: the proxy validating the session, the
 *     route validating it again, then the query. That is what made hovering
 *     take about a second before the object path existed.
 *
 * Either way a card is kept for the life of the page once seen.
 *
 * The sidebar keeps showing the last card after the pointer leaves. Clearing it
 * would mean a list scan is a strobe of appear/disappear, and the previous card
 * is the thing most likely still being read. The tooltip is the opposite: it is
 * anchored to one row, so it must go when the pointer does.
 */

export type Presentation = "sidebar" | "tooltip" | "sheet";

type PanelContext = {
  /** Activate a card. `anchor` is only meaningful for the tooltip. */
  show: (
    source: Card | string,
    presentation: Presentation,
    anchor?: HTMLElement | null,
  ) => void;
  /** Dismiss a transient presentation. The sidebar deliberately keeps its card. */
  hide: () => void;
  activeId: string | null;
  card: Card | null;
  state: "idle" | "loading" | "ready" | "missing";
  /** How the active card is currently being shown, if at all. */
  presentation: Presentation | null;
  /** The element the tooltip is positioned against. */
  anchor: HTMLElement | null;
};

const Ctx = createContext<PanelContext | null>(null);

/**
 * How long the pointer must rest on a card before we go and fetch it.
 *
 * Only applies to the fetching path. When the caller already has the card —
 * which is every list built from a page that loaded the card columns — there is
 * nothing to spend the delay protecting, so the panel updates on the same frame
 * as the hover.
 */
const HOVER_DELAY_MS = 90;

/**
 * How long the pointer must rest before the tooltip appears.
 *
 * Much longer than the fetch delay above, and deliberately so: the tooltip
 * covers part of the page, so it has to be clear the reader meant to summon it
 * rather than merely crossing a row on the way somewhere else. Long enough to
 * never fire while scanning a list; short enough not to feel broken.
 */
const TOOLTIP_DELAY_MS = 650;

export function CardPanelProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, Card | "missing">>({});
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /**
   * Activate a card.
   *
   * The fast path is the caller handing over the card it is already rendering.
   * A collection or deck row was built from a query that selected every column
   * this panel shows, so the data is already in the browser. Fetching it again
   * cost three sequential round trips to Supabase — the proxy checking the
   * session, the route checking it again, then the query — for something
   * already on screen. Handing the object over is the difference between a
   * second and a frame.
   *
   * An id is the slow path, and only that path pays HOVER_DELAY_MS. The tooltip
   * adds its own, longer delay before calling this at all, so the two are not
   * additive in the case that matters.
   */
  const show = useCallback(
    (source: Card | string, next: Presentation, anchorEl?: HTMLElement | null) => {
      if (timer.current) clearTimeout(timer.current);
      setPresentation(next);
      setAnchor(anchorEl ?? null);

      if (typeof source !== "string") {
        setCards((prev) =>
          prev[source.scryfall_id] === source
            ? prev
            : { ...prev, [source.scryfall_id]: source },
        );
        setActiveId(source.scryfall_id);
        return;
      }

      const cardId = source;
      timer.current = setTimeout(() => {
        // Forget a previous failure so hovering again retries.
        //
        // Failures here are usually transient — a dropped connection, or the dev
        // server recompiling mid-request — and caching one for the life of the
        // page meant a single blip left that card permanently reading "Could not
        // load that card" until a full reload. Successes are still cached; only
        // failures are given another chance.
        setCards((prev) => {
          if (prev[cardId] !== "missing") return prev;
          const next = { ...prev };
          delete next[cardId];
          return next;
        });
        setActiveId(cardId);
      }, HOVER_DELAY_MS);
    },
    [],
  );

  /**
   * Dismiss a transient presentation.
   *
   * `activeId` is deliberately left alone: the sidebar goes on showing the last
   * card, and the cache keeps it for the next hover. Only the presentation ends.
   */
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setPresentation((current) => (current === "sidebar" ? current : null));
    setAnchor(null);
  }, []);

  useEffect(() => {
    if (!activeId || cards[activeId]) return;

    const wanted = activeId;
    let cancelled = false;

    (async () => {
      try {
        // `cache: "no-store"` makes the browser skip its HTTP cache for this
        // request entirely.
        //
        // The route sends `no-store` too, but that only governs responses it is
        // still being asked for. An earlier version sent `max-age=3600`, and
        // entries cached under it kept being served for an hour — a reload does
        // not clear them, because a reload only bypasses the cache for the
        // navigation and its subresources, not for fetches JavaScript makes
        // afterwards. Setting the request's cache mode is what actually skips
        // them, and it keeps this honest if the route's headers ever drift.
        const response = await fetch(`/api/cards/${wanted}`, { cache: "no-store" });
        const body = await response.json();
        if (cancelled) return;
        setCards((prev) => ({
          ...prev,
          [wanted]: response.ok && body.card ? (body.card as Card) : "missing",
        }));
      } catch {
        if (!cancelled) setCards((prev) => ({ ...prev, [wanted]: "missing" }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId, cards]);

  const entry = activeId ? cards[activeId] : undefined;

  const value = useMemo<PanelContext>(
    () => ({
      show,
      hide,
      activeId,
      card: entry && entry !== "missing" ? entry : null,
      state: !activeId ? "idle" : entry === "missing" ? "missing" : entry ? "ready" : "loading",
      presentation,
      anchor,
    }),
    [show, hide, activeId, entry, presentation, anchor],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------------------
// Choosing a presentation
// ---------------------------------------------------------------------------

/** Subscribe to a media query without setting state in an effect. */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // The server has no viewport. False for both queries below means the first
    // server render assumes a wide, fine-pointer device, which is the same
    // assumption the markup already makes.
    () => false,
  );
}

/**
 * Which presentation this interaction should use.
 *
 *   - A coarse pointer has no hover at all, so it taps and gets a sheet. The
 *     preference is irrelevant there and is not consulted.
 *   - A fine pointer gets the sidebar only if it asked for the sidebar *and*
 *     there is room to dock one. Below xl there is not, so it falls back to the
 *     tooltip — which is strictly better than the old behaviour, where a narrow
 *     desktop window got no preview whatsoever.
 */
function usePresentation(): Presentation {
  const coarse = useMediaQuery("(pointer: coarse)");
  const wide = useMediaQuery("(min-width: 80rem)"); // Tailwind's xl
  const mode = useCardPreviewMode();

  if (coarse) return "sheet";
  return mode === "sidebar" && wide ? "sidebar" : "tooltip";
}

/**
 * Routes with no card to preview.
 *
 * Everywhere else has at least one thumbnail or card name worth hovering, so
 * the sidebar earns its column there. On these it would be a fifth of the page
 * reserved for an empty box, which is what it used to be on every page.
 *
 * Two lists because `/decks` and `/decks/[id]` disagree: the index is a list of
 * deck names with nothing to hover, while a deck itself is full of cards.
 */
const NO_CARDS_EXACT = ["/decks", "/settings"];
const NO_CARDS_PREFIX = [
  "/friends",
  "/trades",
  "/locations",
  "/notifications",
  "/terms",
  "/settings",
];

function routeHasCards(pathname: string): boolean {
  if (NO_CARDS_EXACT.includes(pathname)) return false;
  return !NO_CARDS_PREFIX.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Where the sidebar renders, and where the other two presentations mount.
 *
 * Separate from the provider so the layout decides placement — the sidebar
 * needs to sit inside the same flex row as the content, not wrap it. Returning
 * null is what lets the main column reclaim the width: it is a flex sibling, so
 * when this renders nothing, `main` fills the row on its own.
 */
export function CardPanelOutlet() {
  const ctx = useContext(Ctx);
  const mode = useCardPreviewMode();
  const pathname = usePathname();

  if (!ctx) return null;

  const sidebarWanted = mode === "sidebar" && routeHasCards(pathname);

  return (
    <>
      {sidebarWanted ? <CardSidebar card={ctx.card} state={ctx.state} /> : null}
      {ctx.presentation === "tooltip" ? <CardTooltip /> : null}
      {ctx.presentation === "sheet" ? <CardSheet /> : null}
    </>
  );
}

/**
 * Handlers for a card thumbnail or name.
 *
 * Pass the whole card wherever you have it — every list built from a query that
 * selected the card columns does — and the panel fills on the same frame as the
 * hover, with no request at all. Pass an id when that is genuinely all you have
 * (the import preview, the printing picker) and it falls back to fetching.
 *
 * Focus is wired alongside hover so the preview works for anyone tabbing through
 * a list rather than pointing at it. Returns nothing useful outside the
 * provider, so a component using it is safe to render anywhere.
 *
 * `sheetOnClick` exists for targets that are already links: on a phone a
 * thumbnail wrapped in a link should follow the link, not open a sheet on top
 * of the navigation it just started.
 */
export function useCardPreview(
  source: Card | string | null | undefined,
  { sheetOnClick = true }: { sheetOnClick?: boolean } = {},
) {
  const ctx = useContext(Ctx);
  const presentation = usePresentation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return useMemo(() => {
    if (!ctx || !source) return {};

    const id = typeof source === "string" ? source : source.scryfall_id;
    const base = { "data-card-preview": id } as const;

    if (presentation === "sheet") {
      if (!sheetOnClick) return base;
      return {
        ...base,
        onClick: () => ctx.show(source, "sheet"),
      };
    }

    if (presentation === "sidebar") {
      const trigger = () => ctx.show(source, "sidebar");
      return { ...base, onMouseEnter: trigger, onFocus: trigger };
    }

    // Tooltip: a deliberate pause opens it, and leaving closes it at once.
    const open = (event: { currentTarget: HTMLElement }) => {
      const element = event.currentTarget;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => ctx.show(source, "tooltip", element), TOOLTIP_DELAY_MS);
    };

    const cancel = () => {
      if (timer.current) clearTimeout(timer.current);
      ctx.hide();
    };

    return {
      ...base,
      onMouseEnter: open,
      onMouseLeave: cancel,
      onFocus: open,
      onBlur: cancel,
    };
  }, [ctx, source, presentation, sheetOnClick]);
}

/**
 * A thumbnail that feeds the panel, for use from server components.
 *
 * Focusable by default so keyboard users get the same behaviour as pointer
 * users. Pass `focusable={false}` when the thumbnail already sits inside
 * something focusable, to avoid a second tab stop for the same card.
 */
export function CardPreviewTarget({
  card,
  className,
  focusable = true,
  children,
}: {
  card: Card | string | null | undefined;
  className?: string;
  focusable?: boolean;
  children: React.ReactNode;
}) {
  const preview = useCardPreview(card);
  return (
    <span {...preview} tabIndex={focusable ? 0 : undefined} className={className}>
      {children}
    </span>
  );
}

/**
 * A link that feeds the panel while it is hovered or focused.
 *
 * For thumbnails that are already links: putting the handlers on the link keeps
 * one tab stop, and means focus reaches the panel too — React's onFocus does
 * not fire on a descendant when an ancestor is focused.
 */
export function CardPreviewLink({
  card,
  href,
  className,
  children,
}: {
  card: Card | string | null | undefined;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  // No sheet on tap: this is a link, and a touch user tapping it means to go
  // where it points. Opening a card sheet over a navigation would be two
  // answers to one gesture.
  const preview = useCardPreview(card, { sheetOnClick: false });
  return (
    <Link href={href} {...preview} className={className}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// The shared renderer
// ---------------------------------------------------------------------------

/**
 * Card details in whatever state the fetch is in.
 *
 * The single renderer behind all three presentations, so the sidebar, the
 * tooltip and the sheet can never disagree about what a card looks like.
 */
function CardDetails({
  card,
  state,
  idleMessage = "Hover a card to see it here.",
}: {
  card: Card | null;
  state: "idle" | "loading" | "ready" | "missing";
  idleMessage?: string;
}) {
  if (state === "idle") {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
        {idleMessage}
      </div>
    );
  }

  if (state === "missing") {
    return (
      <div className="rounded-lg border border-border p-6 text-center text-sm text-ink-muted">
        Could not load that card.
      </div>
    );
  }

  if (card) {
    // Keyed so a new card remounts: the flipped-face state belongs to the card
    // being shown, and resetting it in an effect would render the old face for
    // a frame first.
    return <CardDetail key={card.scryfall_id} card={card} />;
  }

  return (
    <div className="animate-pulse space-y-3">
      <div className="aspect-[488/680] rounded-xl bg-surface-muted" />
      <div className="h-4 w-2/3 rounded bg-surface-muted" />
      <div className="h-3 w-1/2 rounded bg-surface-muted" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentation 1: the docked sidebar
// ---------------------------------------------------------------------------

function CardSidebar({
  card,
  state,
}: {
  card: Card | null;
  state: "idle" | "loading" | "ready" | "missing";
}) {
  // Only rendered at all when the mode and the route both want it — see
  // CardPanelOutlet. The xl guard remains so a window narrowed after load stops
  // reserving the column rather than squeezing the table.
  return (
    <aside
      aria-live="polite"
      aria-label="Card detail"
      className="sticky top-20 hidden h-[calc(100vh-6rem)] w-1/5 shrink-0 overflow-y-auto xl:block xl:pl-8"
    >
      {/* The column is a fifth of the page and usually wider than a card, so the
          content is capped and centred — otherwise the image stretches and the
          slack piles up on one side. */}
      <div className="mx-auto max-w-[18rem]">
        <CardDetails card={card} state={state} />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Presentation 2: the hover tooltip
// ---------------------------------------------------------------------------

/** Gap between the anchor and the tooltip, and the margin kept from the edges. */
const TOOLTIP_GAP = 12;
const TOOLTIP_MARGIN = 8;
const TOOLTIP_WIDTH = 288; // 18rem, matching the sidebar's cap

/**
 * A floating card panel, anchored to whatever was hovered.
 *
 * Rendered through a portal at the end of <body> so no ancestor's `overflow`
 * or stacking context can clip it — the collection table scrolls horizontally,
 * which would otherwise cut a tooltip in half.
 *
 * Positioning is hand-rolled rather than pulling in a library: prefer the right
 * of the anchor, fall back to its left, and clamp to the viewport in both axes
 * so the tooltip can never push the page wide enough to scroll sideways.
 */
function CardTooltip() {
  const ctx = useContext(Ctx);
  const anchor = ctx?.anchor ?? null;
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Measure after layout, before paint, so the tooltip never renders at a
  // stale position for a frame.
  useEffect(() => {
    if (!anchor) return;

    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const height = box.current?.offsetHeight ?? 420;
      const { innerWidth, innerHeight } = window;

      const right = rect.right + TOOLTIP_GAP;
      const left =
        right + TOOLTIP_WIDTH <= innerWidth - TOOLTIP_MARGIN
          ? right
          : Math.max(TOOLTIP_MARGIN, rect.left - TOOLTIP_GAP - TOOLTIP_WIDTH);

      // Vertically centred on the anchor, then pulled back inside the viewport.
      const wanted = rect.top + rect.height / 2 - height / 2;
      const top = Math.min(
        Math.max(TOOLTIP_MARGIN, wanted),
        Math.max(TOOLTIP_MARGIN, innerHeight - height - TOOLTIP_MARGIN),
      );

      setPosition({ top, left });
    };

    place();

    // Anything that moves the anchor invalidates the position. Scrolling while
    // a tooltip is open means the reader has moved on, so it is dismissed
    // rather than chased.
    const dismiss = () => ctx?.hide();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, ctx]);

  // Escape dismisses, matching every other transient surface in the app.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") ctx?.hide();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ctx]);

  if (!ctx || !anchor || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={box}
      role="tooltip"
      // A preview, not a menu: it must never swallow the pointer, or moving
      // toward it would count as leaving the anchor and fight itself.
      className="pointer-events-none fixed z-50 rounded-xl border border-border bg-surface-raised p-3 shadow-xl"
      style={{
        width: TOOLTIP_WIDTH,
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        // Hidden until measured, so it never flashes at the top-left corner.
        visibility: position ? "visible" : "hidden",
      }}
    >
      <CardDetails card={ctx.card} state={ctx.state} />
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Presentation 3: the touch sheet
// ---------------------------------------------------------------------------

/**
 * Card details as a bottom sheet.
 *
 * The answer for touch, where there is no hover to hang either other
 * presentation off. A real <dialog> via showModal(), so it comes with a focus
 * trap, an Escape handler and an inert page behind it.
 */
function CardSheet() {
  const ctx = useContext(Ctx);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  if (!ctx) return null;

  return (
    <dialog
      ref={dialog}
      onClose={() => ctx.hide()}
      onClick={(event) => {
        if (event.target === dialog.current) ctx.hide();
      }}
      aria-label="Card detail"
      className="m-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-2xl bg-surface p-0 text-ink backdrop:bg-scrim sm:mx-auto sm:my-auto sm:max-w-sm sm:rounded-2xl"
    >
      <div className="max-h-[85dvh] overflow-y-auto p-4">
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => ctx.hide()}
            aria-label="Close"
            className="inline-flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="size-5"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <CardDetails card={ctx.card} state={ctx.state} idleMessage="Loading…" />
      </div>
    </dialog>
  );
}

const RARITY_LABEL: Record<string, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
  special: "Special",
  bonus: "Bonus",
};

function CardDetail({ card }: { card: Card }) {
  const faces = card.card_faces ?? null;
  const [faceIndex, setFaceIndex] = useState(0);

  const face: CardFace | null = faces?.[faceIndex] ?? null;
  const image =
    face?.image_uris?.normal ?? face?.image_uris?.large ?? card.image_uri ?? card.image_uri_small;

  // A face's own values win; otherwise the card's, which for a single-faced
  // card is everything.
  const manaCost = face?.mana_cost ?? card.mana_cost;
  const typeLine = face?.type_line ?? card.type_line;
  const oracleText = face?.oracle_text ?? card.oracle_text;
  const flavorText = face?.flavor_text ?? card.flavor_text;
  const power = face?.power ?? card.power;
  const toughness = face?.toughness ?? card.toughness;
  const loyalty = face?.loyalty ?? card.loyalty;
  const artist = face?.artist ?? card.artist;
  const name = face?.name ?? card.name;

  return (
    <div className="space-y-3 pb-6">
      <div className="relative aspect-[488/680] overflow-hidden rounded-xl border border-border bg-surface-muted">
        {image ? (
          <Image
            src={image}
            alt={name}
            fill
            sizes="18rem"
            className="object-cover"
            // Eager, not lazy. The panel only renders once something is
            // hovered, so by the time this exists the image is wanted now —
            // waiting for lazy-loading to notice it is pure delay.
            loading="eager"
            // Scryfall's CDN answers 400 to any request that does not look like
            // a browser, so the optimizer cannot fetch these server-side. The
            // browser can, and does.
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink-muted">
            No image
          </div>
        )}
      </div>

      {faces && faces.length > 1 ? (
        <button
          type="button"
          onClick={() => setFaceIndex((i) => (i + 1) % faces.length)}
          className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-muted"
        >
          Flip to {faces[(faceIndex + 1) % faces.length]?.name ?? "other face"}
        </button>
      ) : null}

      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold leading-snug">{name}</h2>
          {manaCost ? <ManaCost cost={manaCost} /> : null}
        </div>
        {typeLine ? <p className="mt-0.5 text-xs text-ink-muted">{typeLine}</p> : null}
      </div>

      {oracleText ? (
        // Scryfall separates paragraphs with newlines, which would otherwise
        // collapse into one run-on block.
        <p className="whitespace-pre-line text-xs leading-relaxed">{oracleText}</p>
      ) : null}

      {flavorText ? (
        <p className="whitespace-pre-line border-l-2 border-border pl-2 text-xs italic text-ink-muted">
          {flavorText}
        </p>
      ) : null}

      {power || loyalty ? (
        <p className="text-sm font-semibold tabular-nums">
          {loyalty ? `Loyalty ${loyalty}` : `${power} / ${toughness}`}
        </p>
      ) : null}

      <dl className="space-y-1.5 border-t border-border pt-3 text-xs">
        <Row label="Set">
          <span className="block">{card.set_name ?? card.set_code.toUpperCase()}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-ink-muted">
            <SetSymbol code={card.set_code} />({card.set_code.toUpperCase()})
          </span>
        </Row>
        <Row label="Number">#{card.collector_number}</Row>
        {card.rarity ? (
          <Row label="Rarity">{RARITY_LABEL[card.rarity] ?? card.rarity}</Row>
        ) : null}
        {card.released_at ? <Row label="Released">{card.released_at}</Row> : null}
        {artist ? <Row label="Artist">{artist}</Row> : null}
        {card.cmc !== null && card.cmc !== undefined ? (
          <Row label="Mana value">{card.cmc}</Row>
        ) : null}
        <Row label="Language">{languageLabel(card.lang)}</Row>
        <Row label="Finishes">
          <span className="flex flex-wrap gap-1">
            {card.available_finishes.map((f) => (
              <Badge key={f}>{f}</Badge>
            ))}
          </span>
        </Row>
        {card.keywords && card.keywords.length > 0 ? (
          <Row label="Keywords">{card.keywords.join(", ")}</Row>
        ) : null}
        {card.digital ? <Row label="Digital">Not a paper printing</Row> : null}
      </dl>

      {card.scryfall_uri ? (
        <a
          href={card.scryfall_uri}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-block text-xs text-accent underline"
        >
          View on Scryfall
        </a>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
