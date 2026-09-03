/**
 * Splitting a collection by colour and by set, for the dashboard.
 *
 * Pure — the query that feeds it lives in queries.ts. Counts are physical
 * cards (summed quantity), not rows, because "you own 340 red cards" is the
 * sentence someone wants, not "297 red entries".
 */

/** WUBRG, then the two catch-alls. The order the breakdown renders in. */
export const COLOUR_BUCKETS = ["W", "U", "B", "R", "G", "M", "C"] as const;
export type ColourBucket = (typeof COLOUR_BUCKETS)[number];

export const COLOUR_LABELS: Record<ColourBucket, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  M: "Multicolour",
  C: "Colourless",
};

/** The least a row needs to be placed in a bucket. */
export type BreakdownRow = {
  quantity: number;
  cards: { colors: string[] | null; set_code: string | null; set_name: string | null } | null;
};

export type CollectionBreakdown = {
  /** Every non-empty colour bucket, in WUBRG-M-C order. */
  colours: Array<{ bucket: ColourBucket; label: string; count: number }>;
  /** Sets, most cards first. */
  sets: Array<{ code: string; name: string; count: number }>;
};

/** One card's colours -> its bucket. 0 = colourless, 1 = that colour, 2+ = gold. */
function bucketFor(colors: string[] | null | undefined): ColourBucket {
  const list = (colors ?? []).filter((c): c is ColourBucket =>
    (["W", "U", "B", "R", "G"] as string[]).includes(c),
  );
  if (list.length === 0) return "C";
  if (list.length === 1) return list[0];
  return "M";
}

export function summariseBreakdown(rows: BreakdownRow[]): CollectionBreakdown {
  const colourCounts = new Map<ColourBucket, number>();
  const setCounts = new Map<string, { name: string; count: number }>();

  for (const row of rows) {
    const qty = row.quantity;

    const bucket = bucketFor(row.cards?.colors);
    colourCounts.set(bucket, (colourCounts.get(bucket) ?? 0) + qty);

    const code = row.cards?.set_code;
    if (code) {
      const entry = setCounts.get(code) ?? {
        name: row.cards?.set_name ?? code.toUpperCase(),
        count: 0,
      };
      entry.count += qty;
      setCounts.set(code, entry);
    }
  }

  return {
    colours: COLOUR_BUCKETS.filter((b) => (colourCounts.get(b) ?? 0) > 0).map((bucket) => ({
      bucket,
      label: COLOUR_LABELS[bucket],
      count: colourCounts.get(bucket) ?? 0,
    })),
    sets: [...setCounts.entries()]
      .map(([code, { name, count }]) => ({ code, name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
