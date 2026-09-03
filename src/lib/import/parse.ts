/**
 * Turns pasted text or a provider CSV export into rows we can resolve.
 *
 * Two input shapes, one output shape:
 *
 *   - A decklist, as pasted from anywhere: "4 Lightning Bolt", optionally with
 *     a set, collector number and foil marker.
 *   - A CSV/TSV export from Moxfield, ManaBox, Archidekt, Deckbox, or something
 *     we have never seen.
 *
 * The CSV side is header-driven rather than provider-driven. Each field has a
 * list of column names that have been observed to mean it, and an export is
 * read by matching its header row against those. A provider we have not
 * enumerated still imports correctly as long as it calls its columns something
 * reasonable, and supporting a new one is usually adding an alias rather than
 * writing a parser.
 *
 * Nothing here touches the database. Resolving a row to an actual printing is
 * src/lib/import/resolve.ts, and this module is pure so it can be tested
 * exhaustively without one.
 */

import type { Condition, Finish } from "@/lib/types";
import { parseCondition, parseFinish, parseLanguage } from "@/lib/import/vocabulary";

export type ParsedRow = {
  /** 1-based line in the original input, for reporting failures back. */
  line: number;
  /** The original text of the line, echoed in errors so it is recognisable. */
  raw: string;
  quantity: number;
  name: string;
  /** Set code if the export was explicit about it (e.g. ManaBox "Set code"). */
  setCode: string | null;
  /** Full set name if the export gave one (e.g. "Magic 2011"). */
  setName: string | null;
  /**
   * A set-ish value from a column that could be either, most often Moxfield's
   * and Deckbox's "Edition" — the former puts a code there, the latter a name.
   * The resolver tries it both ways rather than guessing here.
   */
  setHint: string | null;
  collectorNumber: string | null;
  finish: Finish | null;
  condition: Condition | null;
  language: string | null;
  /** Some exports carry the printing's Scryfall id, which beats every guess. */
  scryfallId: string | null;
};

export type ParseProblem = { line: number; raw: string; reason: string };

export type ParseResult = {
  rows: ParsedRow[];
  problems: ParseProblem[];
  /** What the input looked like, surfaced in the UI so a mis-detection is visible. */
  format: "csv" | "text" | "empty";
  /** For CSV, the columns we recognised — shown so unmapped data is not a surprise. */
  mappedColumns: Record<string, string>;
};

/** Guards against someone pasting a novel. Generous, but bounded. */
export const MAX_ROWS = 5000;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Splits delimited text into rows of cells.
 *
 * Hand-rolled rather than pulled in as a dependency because the requirement is
 * small and fixed: RFC-4180 quoting, doubled quotes for a literal quote, and
 * newlines inside quoted fields (card names do not contain them, but Moxfield's
 * "Tags" and comment columns do).
 */
export function splitDelimited(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  // Whatever is left when the input ends without a trailing newline.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/** Column aliases, lowercased and stripped of punctuation before comparison. */
const COLUMN_ALIASES: Record<keyof ColumnMap, string[]> = {
  quantity: ["quantity", "count", "qty", "cardcount", "amount", "have"],
  name: ["name", "cardname", "card"],
  setCode: ["setcode", "editioncode", "setid", "expansioncode", "code"],
  setName: ["setname", "editionname", "expansionname", "expansion"],
  setHint: ["set", "edition", "printing"],
  collectorNumber: ["collectornumber", "cardnumber", "number", "collectorno", "cn"],
  finish: ["foil", "finish", "foiltype", "isfoil", "premium"],
  condition: ["condition", "cardcondition", "grade"],
  language: ["language", "lang", "cardlanguage"],
  scryfallId: ["scryfallid", "scryfalluuid", "scryfall"],
};

type ColumnMap = {
  quantity: number | null;
  name: number | null;
  setCode: number | null;
  setName: number | null;
  setHint: number | null;
  collectorNumber: number | null;
  finish: number | null;
  condition: number | null;
  language: number | null;
  scryfallId: number | null;
};

const canonicalise = (header: string) =>
  header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

function mapColumns(header: string[]): ColumnMap {
  const canon = header.map(canonicalise);
  const map = {} as ColumnMap;

  for (const field of Object.keys(COLUMN_ALIASES) as Array<keyof ColumnMap>) {
    const aliases = COLUMN_ALIASES[field];
    // First alias wins, and earlier aliases are the more specific ones — so a
    // file with both "Set code" and "Set name" maps each to its own field
    // rather than both racing for the ambiguous "set".
    let found: number | null = null;
    for (const alias of aliases) {
      const at = canon.indexOf(alias);
      if (at !== -1) {
        found = at;
        break;
      }
    }
    map[field] = found;
  }

  return map;
}

/**
 * Does this header row look like a card export?
 *
 * A name column plus at least one other recognised column. Requiring the name
 * is what stops a decklist whose first line happens to contain a comma from
 * being read as a CSV with one very strange column.
 */
function looksLikeCardCsv(map: ColumnMap): boolean {
  if (map.name === null) return false;
  const others = Object.entries(map).filter(([k, v]) => k !== "name" && v !== null);
  return others.length >= 1;
}

const cell = (cells: string[], at: number | null): string | null => {
  if (at === null || at >= cells.length) return null;
  const value = cells[at]?.trim() ?? "";
  return value === "" ? null : value;
};

function parseCsv(input: string, delimiter: string): ParseResult {
  const table = splitDelimited(input, delimiter).filter(
    (r) => r.length > 0 && r.some((c) => c.trim() !== ""),
  );

  if (table.length === 0) {
    return { rows: [], problems: [], format: "empty", mappedColumns: {} };
  }

  const map = mapColumns(table[0]);
  const header = table[0];

  const mappedColumns: Record<string, string> = {};
  for (const [field, at] of Object.entries(map)) {
    if (at !== null) mappedColumns[field] = header[at]?.trim() ?? "";
  }

  const rows: ParsedRow[] = [];
  const problems: ParseProblem[] = [];

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    // +1 for the header, +1 to make it 1-based, matching what an editor shows.
    const line = i + 1;
    const raw = cells.join(delimiter);

    if (rows.length >= MAX_ROWS) {
      problems.push({ line, raw, reason: `More than ${MAX_ROWS} rows; the rest were ignored.` });
      break;
    }

    const name = cell(cells, map.name);
    if (!name) {
      problems.push({ line, raw, reason: "No card name in this row." });
      continue;
    }

    const quantityCell = cell(cells, map.quantity);
    const quantity = quantityCell === null ? 1 : Number.parseInt(quantityCell, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      problems.push({ line, raw, reason: `"${quantityCell}" is not a usable quantity.` });
      continue;
    }

    rows.push({
      line,
      raw,
      quantity,
      name,
      setCode: cell(cells, map.setCode),
      setName: cell(cells, map.setName),
      setHint: cell(cells, map.setHint),
      collectorNumber: cell(cells, map.collectorNumber),
      finish: parseFinish(cell(cells, map.finish)),
      condition: parseCondition(cell(cells, map.condition)),
      language: parseLanguage(cell(cells, map.language)),
      scryfallId: cell(cells, map.scryfallId),
    });
  }

  return { rows, problems, format: "csv", mappedColumns };
}

// ---------------------------------------------------------------------------
// Text decklists
// ---------------------------------------------------------------------------

/**
 * Section markers that appear on a line of their own. Skipped rather than
 * treated as a card, so a pasted deck with a sideboard does not import a card
 * called "Sideboard".
 */
const SECTION_HEADERS = new Set([
  "deck",
  "sideboard",
  "commander",
  "companion",
  "maybeboard",
  "considering",
  "tokens",
  "main",
  "mainboard",
]);

/**
 * One decklist line.
 *
 *   4 Lightning Bolt
 *   4x Lightning Bolt
 *   4 Lightning Bolt (2X2) 117
 *   1 Sol Ring (C21) 263 *F*
 *   SB: 2 Negate
 *
 * The quantity is optional — a bare list of names is a perfectly common way to
 * paste a collection, and those default to one copy each.
 */
const LINE = /^(?:SB:\s*)?(?:(\d+)\s*[xX]?\s+)?(.+?)\s*$/;

/** Trailing "(SET) 123" or "[SET] 123", as most exporters write it. */
const SET_SUFFIX = /\s*[([]([A-Za-z0-9_]{2,6})[)\]](?:\s+([A-Za-z0-9★-]+))?\s*$/;

/** Moxfield's foil markers, and the "*E*" etched variant. */
const FOIL_MARKER = /\s*\*([FE])\*\s*$/i;

function parseTextLine(rawLine: string, line: number): ParsedRow | ParseProblem | null {
  const text = rawLine.trim();
  if (text === "") return null;

  // Comments, and the "//" some exporters use for section dividers.
  if (text.startsWith("#") || text.startsWith("//")) return null;
  if (SECTION_HEADERS.has(text.toLowerCase().replace(/[:\s]+$/, ""))) return null;

  const match = LINE.exec(text);
  if (!match) return { line, raw: rawLine, reason: "Could not read this line." };

  const quantity = match[1] ? Number.parseInt(match[1], 10) : 1;
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { line, raw: rawLine, reason: `"${match[1]}" is not a usable quantity.` };
  }

  let rest = match[2];
  let finish: Finish | null = null;

  const foil = FOIL_MARKER.exec(rest);
  if (foil) {
    finish = foil[1].toUpperCase() === "E" ? "etched" : "foil";
    rest = rest.slice(0, foil.index).trim();
  }

  let setHint: string | null = null;
  let collectorNumber: string | null = null;

  const set = SET_SUFFIX.exec(rest);
  if (set) {
    setHint = set[1];
    collectorNumber = set[2] ?? null;
    rest = rest.slice(0, set.index).trim();
  }

  const name = rest.trim();
  if (name === "") {
    return { line, raw: rawLine, reason: "No card name on this line." };
  }

  return {
    line,
    raw: rawLine,
    quantity,
    name,
    setCode: null,
    setName: null,
    setHint,
    collectorNumber,
    finish,
    condition: null,
    language: null,
    scryfallId: null,
  };
}

function parseText(input: string): ParseResult {
  const rows: ParsedRow[] = [];
  const problems: ParseProblem[] = [];
  const lines = input.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (rows.length >= MAX_ROWS) {
      problems.push({
        line: i + 1,
        raw: lines[i],
        reason: `More than ${MAX_ROWS} rows; the rest were ignored.`,
      });
      break;
    }

    const result = parseTextLine(lines[i], i + 1);
    if (result === null) continue;
    if ("reason" in result) problems.push(result);
    else rows.push(result);
  }

  return {
    rows,
    problems,
    format: rows.length === 0 && problems.length === 0 ? "empty" : "text",
    mappedColumns: {},
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Picks the delimiter by which one appears most in the first non-blank line. */
function detectDelimiter(firstLine: string): string | null {
  const counts: Array<[string, number]> = [
    ["\t", (firstLine.match(/\t/g) ?? []).length],
    [",", (firstLine.match(/,/g) ?? []).length],
    [";", (firstLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : null;
}

/**
 * Reads whatever was pasted or uploaded.
 *
 * CSV wins only when the first line both splits on a delimiter and maps to
 * something that looks like a card export. Otherwise it is treated as a
 * decklist, which is the more forgiving of the two.
 */
export function parseImport(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { rows: [], problems: [], format: "empty", mappedColumns: {} };
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);

  if (delimiter) {
    const header = splitDelimited(firstLine, delimiter)[0] ?? [];
    if (looksLikeCardCsv(mapColumns(header))) {
      return parseCsv(trimmed, delimiter);
    }
  }

  return parseText(trimmed);
}
