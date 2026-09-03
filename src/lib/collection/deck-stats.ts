/**
 * The numbers behind a deck's Details section: what it costs, its mana curve,
 * and its colour spread.
 *
 * Pure — takes the decklist entries the page already loaded and returns plain
 * data — so the shape of each chart can be tested without rendering one.
 *
 *   - Price sums the list at one copy's price × how many the list wants, using
 *     the same finish rule the rows use (a lone sleeved foil prices as foil,
 *     anything else as non-foil). It reports how many cards it could not price
 *     rather than treating an unpriced card as free.
 *   - The curve buckets non-land cards by mana value (0–6, then 7+) and splits
 *     each bucket by card type.
 *   - Colours count cards by colour identity: a Golgari card counts under both
 *     B and G, which is what "how much of each colour is in here" means.
 */

import type { DeckListEntry } from "@/lib/collection/queries";
import { displayPrice } from "@/lib/collection/pricing";
import {
  DECK_SECTIONS,
  SECTION_LABELS,
  manaSymbols,
  sectionFor,
  type DeckSection,
} from "@/lib/collection/deck-view";

/** The finish a list entry is priced at — matches ListRow in DeckWorkspace. */
function priceFinishFor(entry: DeckListEntry): string {
  return entry.sleevedFinishes.length === 1 ? entry.sleevedFinishes[0] : "nonfoil";
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

export type SectionPrice = {
  section: DeckSection;
  label: string;
  /** Cards in the section (a playset of 4 counts as 4). */
  cards: number;
  /** …of those, how many carried a price. */
  priced: number;
  /** …and how many did not. */
  unpriced: number;
  /** Sum of price × quantity across the priced cards. */
  total: number;
};

export type DeckPrice = {
  total: number;
  priced: number;
  unpriced: number;
  cards: number;
  /** Per section, in the decklist's canonical section order, non-empty only. */
  sections: SectionPrice[];
};

// ---------------------------------------------------------------------------
// Mana curve
// ---------------------------------------------------------------------------

export type CurveSegment = { section: DeckSection; label: string; count: number };

export type CurveBucket = {
  /** "0"…"6", then "7+". */
  label: string;
  /** Cards in the bucket. */
  total: number;
  /** The bucket split by card type, non-zero only, in section order. */
  segments: CurveSegment[];
};

// ---------------------------------------------------------------------------
// Colour identity
// ---------------------------------------------------------------------------

export const DECK_COLORS = ["W", "U", "B", "R", "G", "C"] as const;
export type DeckColor = (typeof DECK_COLORS)[number];

export const DECK_COLOR_LABELS: Record<DeckColor, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

export type ColorCount = {
  code: DeckColor;
  label: string;
  /** Cards with this colour in their identity (a gold card counts under each). */
  count: number;
  /** Share of all cards on the list that carry this colour, 0–1. */
  cardShare: number;
  /** Mana pips of this colour across every mana cost on the list. */
  pips: number;
  /** Share of all coloured pips that are this colour, 0–1. */
  pipShare: number;
};

// ---------------------------------------------------------------------------

export type DeckStats = {
  totalCards: number;
  price: DeckPrice;
  curve: CurveBucket[];
  /** Only colours that appear, in WUBRG-then-colourless order. */
  colors: ColorCount[];
};

/** Card types that appear on the curve, in the order the bars stack. */
const CURVE_SECTIONS = DECK_SECTIONS.filter(
  (s) => s !== "commander" && s !== "lands",
);

export function computeDeckStats(
  entries: DeckListEntry[],
  commanderEntryId: string | null,
): DeckStats {
  // --- price, by section -------------------------------------------------
  const priceBySection = new Map<DeckSection, SectionPrice>();
  let priceTotal = 0;
  let pricedCards = 0;
  let unpricedCards = 0;
  let totalCards = 0;

  // --- curve -----------------------------------------------------------
  const curveBuckets: CurveBucket[] = Array.from({ length: 8 }, (_, i) => ({
    label: i === 7 ? "7+" : String(i),
    total: 0,
    segments: [],
  }));
  const curveByBucketSection: Array<Map<DeckSection, number>> = Array.from(
    { length: 8 },
    () => new Map(),
  );

  // --- colours -------------------------------------------------------
  const colorCounts = new Map<DeckColor, number>();
  const pipCounts = new Map<DeckColor, number>();

  for (const entry of entries) {
    const card = entry.cards;
    const qty = entry.quantity;
    totalCards += qty;

    // Section for price grouping: the nominated commander sits in its own
    // section, the same as the decklist itself.
    const priceSection =
      commanderEntryId && entry.id === commanderEntryId
        ? "commander"
        : sectionFor(card?.type_line);

    const bucket =
      priceBySection.get(priceSection) ??
      ({
        section: priceSection,
        label: SECTION_LABELS[priceSection],
        cards: 0,
        priced: 0,
        unpriced: 0,
        total: 0,
      } satisfies SectionPrice);
    bucket.cards += qty;

    const unit = displayPrice(card, priceFinishFor(entry)).value;
    if (unit === null) {
      bucket.unpriced += qty;
      unpricedCards += qty;
    } else {
      bucket.total += unit * qty;
      bucket.priced += qty;
      priceTotal += unit * qty;
      pricedCards += qty;
    }
    priceBySection.set(priceSection, bucket);

    // Curve: real card type (ignore the commander role), lands excluded.
    const typeSection = sectionFor(card?.type_line);
    if (typeSection !== "lands") {
      const mv = card?.cmc ?? 0;
      const idx = mv >= 7 ? 7 : Math.max(0, Math.floor(mv));
      curveBuckets[idx].total += qty;
      const seg = curveByBucketSection[idx];
      seg.set(typeSection, (seg.get(typeSection) ?? 0) + qty);
    }

    // Colours (cards): by colour identity, a multicolour card counts under each.
    const identity = (card?.color_identity ?? []).filter((c): c is DeckColor =>
      (DECK_COLORS as readonly string[]).includes(c),
    );
    if (identity.length === 0) {
      colorCounts.set("C", (colorCounts.get("C") ?? 0) + qty);
    } else {
      for (const c of identity) colorCounts.set(c, (colorCounts.get(c) ?? 0) + qty);
    }

    // Pips: every coloured symbol in the mana cost, once per copy. A hybrid
    // pip ("R/G") counts toward each of its colours; generic ("2") counts for
    // none. "{C}" is a colourless pip, distinct from having no colour.
    for (const sym of manaSymbols(card?.mana_cost)) {
      for (const letter of sym.toUpperCase().split("/")) {
        if ((DECK_COLORS as readonly string[]).includes(letter)) {
          pipCounts.set(letter as DeckColor, (pipCounts.get(letter as DeckColor) ?? 0) + qty);
        }
      }
    }
  }

  const totalPips = [...pipCounts.values()].reduce((a, b) => a + b, 0);

  // Finalise curve segments.
  curveBuckets.forEach((b, i) => {
    b.segments = CURVE_SECTIONS.filter((s) => (curveByBucketSection[i].get(s) ?? 0) > 0).map(
      (s) => ({
        section: s,
        label: SECTION_LABELS[s],
        count: curveByBucketSection[i].get(s) ?? 0,
      }),
    );
  });

  const sections = DECK_SECTIONS.filter((s) => priceBySection.has(s)).map(
    (s) => priceBySection.get(s)!,
  );

  return {
    totalCards,
    price: {
      total: round2(priceTotal),
      priced: pricedCards,
      unpriced: unpricedCards,
      cards: totalCards,
      sections: sections.map((s) => ({ ...s, total: round2(s.total) })),
    },
    curve: curveBuckets,
    colors: DECK_COLORS.filter(
      (c) => (colorCounts.get(c) ?? 0) > 0 || (pipCounts.get(c) ?? 0) > 0,
    ).map((c) => {
      const count = colorCounts.get(c) ?? 0;
      const pips = pipCounts.get(c) ?? 0;
      return {
        code: c,
        label: DECK_COLOR_LABELS[c],
        count,
        cardShare: totalCards > 0 ? count / totalCards : 0,
        pips,
        pipShare: totalPips > 0 ? pips / totalPips : 0,
      };
    }),
  };
}

/** Round once, at the end — summing rounded cents drifts on a big list. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
