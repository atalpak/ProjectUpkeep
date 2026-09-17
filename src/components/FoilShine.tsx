import { isShinyFinish } from "@/components/FoilMark";

/**
 * Lays the same shimmering rainbow `.foil-mark` uses over a card image
 * instead of a glyph — dropped inside any `position: relative` image
 * wrapper, absolutely filling it. Renders nothing for a plain non-foil
 * copy, same as `FoilMark`.
 */
export function FoilShine({ finish }: { finish: string }) {
  if (!isShinyFinish(finish)) return null;
  return <div aria-hidden className="foil-shine" />;
}
