/**
 * Serialising a collection (or a deck) for export.
 *
 * Pure — no DB client, no DOM, nothing async — so every escaping edge case is
 * testable without rendering a page or mocking Supabase. The two formats this
 * produces have different jobs:
 *
 *   - A text decklist: quantity + name, with set/collector-number/foil as
 *     widely-supported enrichment. Meant for pasting into Moxfield or
 *     Archidekt, which is why it is spelled their way (a bare "Commander"
 *     header, "*F*"/"*E*" foil markers) rather than ours.
 *   - A CSV: full per-stack detail — name, set, collector number, finish,
 *     condition, language, quantity, and (collection only) location. Meant to
 *     round-trip through *this* app's own importer, which is why every header
 *     and value below is chosen to match what
 *     src/lib/import/parse.ts#mapColumns and src/lib/import/vocabulary.ts
 *     already recognise. See scripts/export.test.ts for the round-trip check
 *     against that importer's own parser.
 *
 * Neither format is a decklist import target for the text format — that one
 * targets Moxfield/Archidekt, not us, and is not held to the same
 * round-trips-through-our-own-parser bar the CSV is.
 */

/** The least a row needs to name a printing on either format. */
export type ExportCardRef = {
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
};

/**
 * One stack (or one decklist line), ready to serialise.
 *
 * `finish`/`condition`/`language` carry this app's own vocabulary already —
 * see src/lib/types.ts's FINISHES/CONDITIONS and the language table — so they
 * pass straight through parseFinish/parseCondition/parseLanguage unchanged on
 * the way back in. A decklist entry (no physical copy behind it) simply
 * leaves them null.
 */
// Type-only, so this module stays free of runtime dependencies — the reason it
// can be tested without a database or a DOM.
import type { CardInstanceWithCard } from "@/lib/types";

export type ExportRow = {
  card: ExportCardRef | null;
  quantity: number;
  finish: string | null;
  condition: string | null;
  language: string | null;
  /** Collection CSV only — the deck export drops this column entirely. */
  locationName: string | null;
};

// ---------------------------------------------------------------------------
// Text decklist
// ---------------------------------------------------------------------------

/** "*F*" for foil, "*E*" for etched — the marker src/lib/import/parse.ts's own FOIL_MARKER already reads. */
function foilSuffix(finish: string | null): string {
  if (finish === "foil") return " *F*";
  if (finish === "etched") return " *E*";
  return "";
}

/** "4 Lightning Bolt (M10) 146 *F*" — omitting whichever parts are missing. */
function decklistLine(row: ExportRow): string {
  const name = row.card?.name ?? "Unknown card";
  const setPart = row.card?.setCode ? ` (${row.card.setCode.toUpperCase()})` : "";
  const numberPart = row.card?.collectorNumber ? ` ${row.card.collectorNumber}` : "";
  return `${row.quantity} ${name}${setPart}${numberPart}${foilSuffix(row.finish)}`;
}

/**
 * A flat decklist: one line per row, in the order given.
 *
 * Used for the collection export, where there are no deck sections to group
 * by — just every stack currently on screen. Sort order is the caller's call
 * (typically whatever the page is already showing); this only formats.
 */
/**
 * One physical stack, as `getCollection` returns it, mapped for export.
 *
 * Lives here rather than on the collection page because the export route and
 * the page both need it, and the mapping is part of what "export" means.
 */
export function stackToExportRow(row: CardInstanceWithCard): ExportRow {
  return {
    card: row.cards
      ? {
          name: row.cards.name,
          setCode: row.cards.set_code,
          collectorNumber: row.cards.collector_number,
        }
      : null,
    quantity: row.quantity,
    finish: row.finish,
    condition: row.condition,
    language: row.language,
    locationName: row.locations?.name ?? null,
  };
}

export function stacksToDecklistText(rows: ExportRow[]): string {
  if (rows.length === 0) return "";
  return rows.map(decklistLine).join("\n") + "\n";
}

export type DecklistSection = { label: string; rows: ExportRow[] };

/**
 * A deck's decklist: an optional Commander block Moxfield/Archidekt both read,
 * then every other card as one flat list.
 *
 * The type-group headings ("# Creatures", "# Lands", ...) the page shows on
 * screen are deliberately left out of the export — a pasted list only needs
 * quantity + name per line, and Moxfield/Archidekt regroup by type on import
 * anyway. The `Commander` block stays, because that one *is* a real deck zone
 * both readers act on, not a display grouping.
 *
 * `sections` is still taken as-is (rather than a flat array) so the caller can
 * keep passing the same grouped structure the page already computes; the order
 * of the sections is the order the lines come out in.
 */
export function deckToDecklistText(
  commander: ExportRow | null,
  sections: DecklistSection[],
): string {
  const lines: string[] = [];

  if (commander) {
    lines.push("Commander");
    lines.push(decklistLine(commander));
    lines.push("");
  }

  for (const section of sections) {
    for (const row of section.rows) lines.push(decklistLine(row));
  }

  if (lines.length === 0) return "";

  // One trailing newline.
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const CSV_HEADERS = ["Name", "Set Code", "Collector Number", "Finish", "Condition", "Language", "Quantity"];
const CSV_HEADERS_WITH_LOCATION = [...CSV_HEADERS, "Location"];

/**
 * RFC 4180 field escaping: quote a field that contains a comma, a quote, or a
 * newline, doubling any quote inside it. Everything else passes through
 * unquoted — not required by the RFC, but every reader (and our own parser)
 * accepts it, and it keeps a plain export readable without opening it in a
 * spreadsheet.
 */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * The full CSV: a header row plus one row per stack.
 *
 * CRLF line endings throughout, per RFC 4180 — this is generated output, not
 * a file tracked in the repo, so it is unrelated to (and does not reintroduce)
 * this codebase's own LF convention for source files. Our own importer copes
 * with either: splitDelimited (src/lib/import/parse.ts) already drops a bare
 * "\r" while building a cell, which is what makes CRLF input safe to read
 * back in.
 */
export function toCsv(rows: ExportRow[], options: { includeLocation: boolean }): string {
  const headers = options.includeLocation ? CSV_HEADERS_WITH_LOCATION : CSV_HEADERS;
  const lines = [headers.join(",")];

  for (const row of rows) {
    const cells = [
      row.card?.name ?? "",
      row.card?.setCode ?? "",
      row.card?.collectorNumber ?? "",
      row.finish ?? "",
      row.condition ?? "",
      row.language ?? "",
      String(row.quantity),
    ];
    if (options.includeLocation) cells.push(row.locationName ?? "");
    lines.push(cells.map(csvField).join(","));
  }

  return lines.join("\r\n") + "\r\n";
}
