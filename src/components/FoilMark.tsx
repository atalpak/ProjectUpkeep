import type { Finish } from "@/lib/types";
import { FINISH_LABELS } from "@/lib/types";

/**
 * Marks a copy that is not plain non-foil.
 *
 * Replaces the Finish column on the collection table. A column spent its width
 * writing "Non-foil" on almost every row; what people actually scan for is the
 * handful that are not, and a mark beside the name puts that where the eye
 * already is.
 *
 * Etched and glossy get their own letter rather than being folded into "F" or
 * dropped. They are rarer than foil but they are real finishes someone paid
 * attention to when recording the card, and silently hiding them would lose
 * information the column used to carry.
 *
 * The rainbow and the glow live in .foil-mark in globals.css, because a
 * background-clipped animated gradient is more legible as CSS than as a string
 * of utility classes.
 */

const LETTERS: Partial<Record<Finish, string>> = {
  foil: "F",
  etched: "E",
  glossy: "G",
};

export function FoilMark({ finish }: { finish: string }) {
  const letter = LETTERS[finish as Finish];
  // nonfoil, or a finish we have no mark for: the absence is the information.
  if (!letter) return null;

  const label = FINISH_LABELS[finish as Finish] ?? finish;

  return (
    <span
      className="foil-mark ml-1 align-middle text-xs font-extrabold tracking-tight select-none"
      title={label}
      // The letter is decorative shorthand; the finish is announced in words.
      aria-label={label}
      role="img"
    >
      {letter}
    </span>
  );
}
