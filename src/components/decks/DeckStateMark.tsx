import { DECK_STATE_LABELS, type EntryState } from "@/lib/collection/deck-state";
import { cx } from "@/components/ui";

/**
 * The one-glance answer for a decklist entry.
 *
 * Three states, three shapes — not three colours. Colour alone would leave the
 * distinction invisible to a colourblind reader, and this is the primary signal
 * on the page, so the glyphs differ as much as the hues do:
 *
 *   ✓  sleeved   — in the box
 *   ●  available — in a binder, one click from the box
 *   ✕  missing   — not owned
 *
 * The title carries the counts, because "2 of 4" is the follow-up question the
 * mark always provokes.
 */

const STYLES: Record<EntryState["state"], string> = {
  sleeved: "bg-[#1f7a4d] text-white ring-[#2f9d68]",
  available: "bg-[#b8862b] text-white ring-[#d6a44a]",
  missing: "bg-[#8a2f2f] text-white ring-[#b04747]",
};

const GLYPHS: Record<EntryState["state"], string> = {
  sleeved: "✓",
  available: "●",
  missing: "✕",
};

function describe(entry: EntryState): string {
  const base = `${DECK_STATE_LABELS[entry.state]} — ${entry.sleeved} of ${entry.wanted} sleeved`;
  if (entry.state === "sleeved") return base;
  if (entry.state === "available") {
    return `${base}, ${entry.sleevable} more ready to sleeve`;
  }
  return `${base}, no spare copies in your collection`;
}

export function DeckStateMark({
  entry,
  size = "sm",
}: {
  entry: EntryState;
  size?: "sm" | "lg";
}) {
  const label = describe(entry);

  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none ring-1 ring-inset",
        size === "lg" ? "size-6 text-[13px]" : "size-4 text-[10px]",
        STYLES[entry.state],
      )}
      title={label}
      aria-label={label}
      role="img"
    >
      {GLYPHS[entry.state]}
    </span>
  );
}
