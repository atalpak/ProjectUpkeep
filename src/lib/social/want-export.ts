/**
 * Serialising a wish list for export.
 *
 * Same two formats the collection uses (src/lib/collection/export.ts), and
 * the CSV is deliberately shaped to match: `Name, Set Code, Collector Number,
 * Quantity` is a strict subset of the collection's own header, which is what
 * lets it round-trip through the same importer (parse.ts + resolve.ts) — a
 * want has no finish/condition/language/location for that CSV to carry, so
 * those columns are simply left off rather than written empty every row.
 *
 * Pure, like its collection counterpart: no DB client, so every escaping edge
 * case is testable without one. `csvField` is imported rather than
 * reimplemented — one escaping rule for the whole app.
 */

import { csvField } from "@/lib/collection/export";

export type WantExportRow = {
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
  quantity: number;
};

const CSV_HEADERS = ["Name", "Set Code", "Collector Number", "Quantity"];

export function wantsToCsv(rows: WantExportRow[]): string {
  const lines = [CSV_HEADERS.join(",")];

  for (const row of rows) {
    const cells = [row.name, row.setCode ?? "", row.collectorNumber ?? "", String(row.quantity)];
    lines.push(cells.map(csvField).join(","));
  }

  return lines.join("\r\n") + "\r\n";
}

/** "4 Lightning Bolt (M10) 146" — omitting whichever parts are missing. */
function decklistLine(row: WantExportRow): string {
  const setPart = row.setCode ? ` (${row.setCode.toUpperCase()})` : "";
  const numberPart = row.collectorNumber ? ` ${row.collectorNumber}` : "";
  return `${row.quantity} ${row.name}${setPart}${numberPart}`;
}

export function wantsToDecklistText(rows: WantExportRow[]): string {
  if (rows.length === 0) return "";
  return rows.map(decklistLine).join("\n") + "\n";
}
