/**
 * The two lines every printing picker shows beside a printing's thumbnail.
 *
 * Four pickers (add-card, the card popup, the want-list draft row and the
 * deck row menu) each used to build their own "Set · #123 · 2019" string, and
 * none of them could say which finishes a printing comes in, which is often
 * the reason two otherwise identical rows exist. One function so the four
 * cannot drift apart again.
 */

export type PrintingFacts = {
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  released_at: string | null;
  rarity?: string | null;
  available_finishes?: readonly string[] | null;
};

const FINISH_NAMES: Record<string, string> = {
  nonfoil: "Non-foil",
  foil: "Foil",
  etched: "Etched foil",
  glossy: "Glossy",
};

/** "Non-foil, Foil" for a printing's finishes; empty when Scryfall gave none. */
export function finishesLabel(finishes: readonly string[] | null | undefined): string {
  if (!finishes || finishes.length === 0) return "";
  return finishes.map((f) => FINISH_NAMES[f] ?? f).join(", ");
}

/** `title` is the set, `detail` is number, year, rarity and finishes joined by " · ". */
export function printingSummary(p: PrintingFacts): { title: string; detail: string } {
  const title = p.set_name ?? p.set_code?.toUpperCase() ?? "Unknown set";
  const detail = [
    p.collector_number ? `#${p.collector_number}` : "",
    p.released_at ? p.released_at.slice(0, 4) : "",
    p.rarity ?? "",
    finishesLabel(p.available_finishes),
  ]
    .filter(Boolean)
    .join(" · ");
  return { title, detail };
}
