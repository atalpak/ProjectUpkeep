import { manaSymbols } from "@/lib/collection/deck-view";
import { cx } from "@/components/ui";

/**
 * A printed mana cost, as coloured pips.
 *
 * Drawn rather than fetched: Scryfall publishes symbol images, but a decklist
 * shows hundreds of these and each would be a network request against a CDN
 * that already refuses our server-side fetches. Circles with a letter carry the
 * same information, cost nothing, and stay crisp at any size.
 *
 * The colours are fixed rather than themed. A red pip has to look red in both
 * light and dark mode — that is what makes a cost readable at a glance — so
 * these deliberately sit outside the theme tokens, with their own text colour
 * chosen per pip rather than inherited.
 */

const PIP_STYLES: Record<string, string> = {
  W: "bg-[#fbfaf3] text-[#1a1a1a] ring-[#d9d2b8]",
  U: "bg-[#9fd6ee] text-[#0d2b38] ring-[#6fb3d0]",
  B: "bg-[#bab1ab] text-[#1a1a1a] ring-[#918881]",
  R: "bg-[#f6a08b] text-[#3b1109] ring-[#d97a63]",
  G: "bg-[#9cd3ab] text-[#0d2c16] ring-[#6fae82]",
  // Colourless, generic numbers, X, and anything else.
  default: "bg-[#cac5c0] text-[#1a1a1a] ring-[#a8a29c]",
};

const styleFor = (symbol: string): string => {
  // Hybrid and Phyrexian symbols ("R/G", "U/P") take the first colour they
  // name, which is enough to read the cost at a glance.
  const first = symbol.split("/")[0].toUpperCase();
  return PIP_STYLES[first] ?? PIP_STYLES.default;
};

export function ManaCost({
  cost,
  className,
  size = "sm",
}: {
  cost: string | null | undefined;
  className?: string;
  size?: "sm" | "xs";
}) {
  const symbols = manaSymbols(cost);
  if (symbols.length === 0) return null;

  const box = size === "xs" ? "h-3.5 min-w-3.5 text-[9px]" : "h-4 min-w-4 text-[10px]";

  return (
    <span
      className={cx("inline-flex shrink-0 items-center gap-0.5 align-middle", className)}
      // The pips are decorative; the cost is announced once, as text.
      role="img"
      aria-label={`Mana cost ${symbols.join(" ")}`}
    >
      {symbols.map((symbol, i) => (
        <span
          key={`${symbol}-${i}`}
          aria-hidden="true"
          className={cx(
            "inline-flex items-center justify-center rounded-full px-1 font-semibold ring-1 ring-inset",
            box,
            styleFor(symbol),
          )}
        >
          {symbol.replace("/", "")}
        </span>
      ))}
    </span>
  );
}
