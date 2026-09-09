import { DECK_STATE_LABELS, type EntryState } from "@/lib/collection/deck-state";
import {
  LIST_CHECK_LABELS,
  type CheckedEntry,
} from "@/lib/collection/list-check";
import { cx } from "@/components/ui";

/**
 * The one-glance answer for a list entry.
 *
 * Three tones, three shapes — not three colours. Colour alone would leave the
 * distinction invisible to a colourblind reader, and this is the primary signal
 * on the page, so the glyphs differ as much as the hues do:
 *
 *   ✓  have      — nothing left to do for this entry.
 *   ●  reachable — you own it; it is one action away.
 *   ✕  absent    — you do not own enough copies.
 *
 * Two screens ask closely related questions and answer them with the same three
 * marks, so the vocabulary lives here once:
 *
 *   - `DeckStateMark` — a real deck: sleeved / available / not available.
 *   - `ListCheckMark` — a list you have not built: ready / in another deck /
 *     not owned.
 *
 * A reader who has learned "green tick means sorted" on one page must not have
 * to relearn it on the other, which is exactly what would happen if each screen
 * picked its own palette.
 */

type Tone = "have" | "reachable" | "absent";

const STYLES: Record<Tone, string> = {
  have: "bg-[#1f7a4d] text-white ring-[#2f9d68]",
  reachable: "bg-[#b8862b] text-white ring-[#d6a44a]",
  absent: "bg-[#8a2f2f] text-white ring-[#b04747]",
};

const GLYPHS: Record<Tone, string> = {
  have: "✓",
  reachable: "●",
  absent: "✕",
};

function StateMark({
  tone,
  label,
  size,
}: {
  tone: Tone;
  label: string;
  size: "sm" | "lg";
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none ring-1 ring-inset",
        size === "lg" ? "size-6 text-[13px]" : "size-4 text-[10px]",
        STYLES[tone],
      )}
      title={label}
      aria-label={label}
      role="img"
    >
      {GLYPHS[tone]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// A deck you are building
// ---------------------------------------------------------------------------

const DECK_TONES: Record<EntryState["state"], Tone> = {
  sleeved: "have",
  available: "reachable",
  missing: "absent",
};

/** The title carries the counts, because "2 of 4" is the follow-up question the
 *  mark always provokes. */
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
  return <StateMark tone={DECK_TONES[entry.state]} label={describe(entry)} size={size} />;
}

// ---------------------------------------------------------------------------
// A list you have not committed to
// ---------------------------------------------------------------------------

const CHECK_TONES: Record<CheckedEntry["state"], Tone> = {
  ready: "have",
  elsewhere: "reachable",
  missing: "absent",
};

/**
 * Where this entry's copies would come from, spelled out.
 *
 * The mark says which of the three it is; the title says how the copies split,
 * which is the whole reason "in another deck" is its own state rather than
 * being folded in with "not owned".
 */
function describeCheck(entry: CheckedEntry): string {
  const parts = [
    entry.fromFree > 0 ? `${entry.fromFree} free` : null,
    entry.fromDecks > 0 ? `${entry.fromDecks} in another deck` : null,
    entry.short > 0 ? `${entry.short} not owned` : null,
  ].filter(Boolean);

  return `${LIST_CHECK_LABELS[entry.state]} — ${entry.wanted} wanted: ${parts.join(", ")}`;
}

export function ListCheckMark({
  entry,
  size = "sm",
}: {
  entry: CheckedEntry;
  size?: "sm" | "lg";
}) {
  return <StateMark tone={CHECK_TONES[entry.state]} label={describeCheck(entry)} size={size} />;
}
