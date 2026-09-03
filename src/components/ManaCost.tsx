import Image from "next/image";

import { manaSymbols } from "@/lib/collection/deck-view";
import { cx } from "@/components/ui";

/**
 * A printed mana cost, drawn with Magic's own symbols.
 *
 * Each pip is the official SVG from Scryfall's symbol CDN
 * (svgs.scryfall.io/card-symbols/<CODE>.svg), loaded client-side as a plain
 * image. Scryfall serves and caches these freely, and a decklist only ever
 * touches ~20 distinct symbols, so the browser fetches each once and reuses it
 * everywhere after. The art already carries its own colour and a light
 * outline, so it reads in both themes with no theming here.
 *
 * `svgs.scryfall.io` is allow-listed in next.config.ts; `unoptimized` skips the
 * image optimiser (which refuses remote SVGs) and emits a bare <img>.
 */

// Scryfall names each symbol file by its contents with the slash removed:
// {G} -> G.svg, {2} -> 2.svg, {R/G} -> RG.svg, {U/P} -> UP.svg, {C/W} -> CW.svg.
const SYMBOL_BASE = "https://svgs.scryfall.io/card-symbols";
const srcFor = (symbol: string) =>
  `${SYMBOL_BASE}/${symbol.replace(/\//g, "").toUpperCase()}.svg`;

const PX = { sm: 16, xs: 14 } as const;

/** One mana symbol, by its inner code ("G", "2", "R/G", "U/P", "T"). */
export function ManaSymbol({
  code,
  size = "sm",
  className,
}: {
  code: string;
  size?: "sm" | "xs";
  className?: string;
}) {
  const px = PX[size];
  return (
    <Image
      src={srcFor(code)}
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      unoptimized
      className={cx("inline-block shrink-0 align-middle", className)}
    />
  );
}

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

  return (
    <span
      className={cx("inline-flex shrink-0 items-center gap-0.5 align-middle", className)}
      // The pips are decorative; the cost is announced once, as text.
      role="img"
      aria-label={`Mana cost ${symbols.join(" ")}`}
    >
      {symbols.map((symbol, i) => (
        <ManaSymbol key={`${symbol}-${i}`} code={symbol} size={size} />
      ))}
    </span>
  );
}
