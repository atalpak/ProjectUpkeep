"use client";

import { useActionState } from "react";

import { addWant } from "@/app/(app)/wants/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
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
 *   ✓  have      — nothing left to do for this entry, glowing green.
 *   ↓  reachable — you own it; it is one action away, glowing yellow.
 *   ✕  absent    — you do not own enough copies, glowing red.
 *
 * No circle behind any of them — the glow itself is the badge, so the glyph
 * can sit directly on the row instead of inside a filled chip. Each glyph also
 * carries a thin dark outline (`text-shadow`, not `drop-shadow` — the latter
 * only takes one shadow, and this needs two): the glow reads as "glowing" on
 * a dark background, but on light mode it is the outline, not the glow, that
 * keeps a pastel glyph from washing out against a pale page.
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

/** `color glow, glow, outline, outline` — two soft colour blurs for the neon
 *  look plus two 1px dark passes standing in for an outline (`text-shadow`
 *  has no stroke of its own). */
function glow(rgb: string): string {
  return `[text-shadow:0_0_6px_rgba(${rgb},0.9),0_0_10px_rgba(${rgb},0.5),0_0_1px_rgba(0,0,0,0.75),0_1px_1px_rgba(0,0,0,0.6)]`;
}

/** A hotter version of `glow` for the 🛒 marks specifically — the emoji's own
 *  built-in colouring dilutes a normal-strength glow more than the flat text
 *  glyphs do, and read as washed out in dark mode next to them. Bigger, more
 *  opaque blurs compensate. */
function cartGlow(rgb: string): string {
  return `[text-shadow:0_0_8px_rgba(${rgb},1),0_0_16px_rgba(${rgb},0.85),0_0_1px_rgba(0,0,0,0.75),0_1px_1px_rgba(0,0,0,0.6)]`;
}

const GLOW: Record<Tone, string> = {
  have: cx("text-[#22c55e]", glow("34,197,94")),
  reachable: cx("text-[#eab308]", glow("234,179,8")),
  absent: cx("text-[#ef4444]", glow("239,68,68")),
};

/** The fourth mark, `DeckStateMark`-only: a card already on the wish list. Not
 *  part of `Tone` — it is a status on top of "absent", not a fourth thing the
 *  entry itself can be. */
const WISHLISTED_GLOW = cx("text-[#3b82f6]", cartGlow("59,130,246"));

const GLYPHS: Record<Tone, string> = {
  have: "✓",
  reachable: "↓",
  absent: "✕",
};

const CART_GLYPH = "🛒";

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
        "inline-flex shrink-0 items-center justify-center font-bold leading-none",
        size === "lg" ? "text-lg" : "text-sm",
        GLOW[tone],
      )}
      title={label}
      aria-label={label}
      role="img"
    >
      {GLYPHS[tone]}
    </span>
  );
}

/**
 * The "absent" mark, made actionable: hovering the glowing ✕ swaps it for a
 * 🛒 with a little bounce, and a tooltip spells out what clicking does —
 * "Add to wish list" is not obvious from an X alone, so the mark says it
 * rather than relying on people trying it. Clicking adds the card to this
 * deck's wish list, the natural next step for a card you don't own, one
 * motion away instead of a trip to the wish-list section further down the
 * page. Goes through the same `addWant` server action as `AddToWishList`,
 * tagged to this deck (see that action's doc comment for why re-adding an
 * already-wanted card is not an error).
 *
 * Once the card is actually on the wish list, this stops being a button: the
 * page's own `wishList` data (revalidated by the action) reports it back
 * through `onList`, and the mark becomes a static blue 🛒 — a real status, not
 * a hover preview, so it has to survive the mouse moving away. The hover
 * preview above is tinted red rather than that blue specifically so the two
 * never look identical — one is "click to add", the other is "already added".
 */
function MissingMark({
  label,
  size,
  cardName,
  deckId,
  onList,
}: {
  label: string;
  size: "sm" | "lg";
  cardName: string;
  deckId: string;
  onList: boolean;
}) {
  const [state, add, adding] = useActionState(addWant, EMPTY_SOCIAL_STATE);
  const sizeClass = size === "lg" ? "text-lg" : "text-sm";

  if (onList) {
    return (
      <span
        className={cx("inline-flex shrink-0 items-center justify-center leading-none", sizeClass, WISHLISTED_GLOW)}
        title={`${label} — on your wish list`}
        aria-label={`${label} — on your wish list`}
        role="img"
      >
        {CART_GLYPH}
      </span>
    );
  }

  const tooltip = state.error ?? "Add to wish list";
  const accessibleLabel = state.error ?? `${label} — add to wish list`;

  return (
    <form action={add} className="inline-block">
      <input type="hidden" name="deck_id" value={deckId} />
      <input type="hidden" name="card_name" value={cardName} />
      <input type="hidden" name="quantity" value="1" />
      <button
        type="submit"
        disabled={adding}
        aria-label={accessibleLabel}
        className="group/mark relative inline-flex shrink-0 items-center justify-center disabled:opacity-60"
      >
        {/* Custom tooltip, not the native `title` — this needs to appear
            instantly and in step with the icon swap, which a browser tooltip's
            own delay can't do. Decorative: the button's aria-label already
            carries the same information for assistive tech. */}
        <span
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2 scale-90 whitespace-nowrap rounded-md bg-surface-raised px-2 py-1 text-[11px] font-medium text-ink opacity-0 shadow-lg ring-1 ring-border transition-all duration-150",
            "group-hover/mark:scale-100 group-hover/mark:opacity-100 group-focus-visible/mark:scale-100 group-focus-visible/mark:opacity-100",
          )}
        >
          {tooltip}
        </span>

        <span
          className={cx(
            "font-bold leading-none transition-all duration-200",
            sizeClass,
            GLOW.absent,
            "group-hover/mark:scale-0 group-hover/mark:opacity-0 group-focus-visible/mark:scale-0 group-focus-visible/mark:opacity-0",
          )}
        >
          {GLYPHS.absent}
        </span>
        <span
          aria-hidden="true"
          className={cx(
            "absolute inset-0 flex scale-0 items-center justify-center opacity-0 transition-all duration-200",
            sizeClass,
            cartGlow("239,68,68"),
            "group-hover/mark:scale-110 group-hover/mark:opacity-100 group-hover/mark:animate-bounce group-focus-visible/mark:scale-110 group-focus-visible/mark:opacity-100",
          )}
        >
          {CART_GLYPH}
        </span>
      </button>
    </form>
  );
}

/**
 * The "reachable" mark, made actionable: hovering the glowing ↓ nudges it
 * with a bounce, and a tooltip spells out how many spare copies are sitting
 * where, and that a click sleeves them. Clicking submits the same `sleeve`
 * server action as the row's own ⋯ menu ("Sleeve N from your collection" —
 * see `RowActions` in DeckWorkspace.tsx), so this is a shortcut to that
 * existing move, not a second way of doing it.
 *
 * There is no local "just sleeved" state to fake here, unlike the ✕ → 🛒
 * mark: sleeving changes `entry.sleeved`, which changes `entry.state` itself
 * once the deck page's server data is revalidated, so the row simply stops
 * being "available" and starts being "sleeved" — the mark becomes a real ✓
 * because the entry really is done, not because this component says so.
 */
function ReachableMark({
  label,
  size,
  deckId,
  cardId,
  quantity,
  spareIn,
  sleeve,
  sleeving,
}: {
  label: string;
  size: "sm" | "lg";
  deckId: string;
  cardId: string;
  quantity: number;
  spareIn: readonly string[];
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
}) {
  const sizeClass = size === "lg" ? "text-lg" : "text-sm";
  const location = spareIn.length > 0 ? ` (${spareIn.join(", ")})` : "";

  return (
    <form action={sleeve} className="inline-block">
      <input type="hidden" name="deck_id" value={deckId} />
      <input type="hidden" name="card_id" value={cardId} />
      <input type="hidden" name="quantity" value={quantity} />
      <button
        type="submit"
        disabled={sleeving}
        aria-label={`${label} — click to sleeve`}
        className="group/mark relative inline-flex shrink-0 items-center justify-center disabled:opacity-60"
      >
        {/* Two lines: what would happen, and that a click does it — the
            same reason the ✕ → 🛒 mark spells its action out rather than
            leaving people to guess what an arrow means. */}
        <span
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute -top-12 left-1/2 z-20 -translate-x-1/2 scale-90 whitespace-nowrap rounded-md bg-surface-raised px-2 py-1 text-center text-[11px] font-medium text-ink opacity-0 shadow-lg ring-1 ring-border transition-all duration-150",
            "group-hover/mark:scale-100 group-hover/mark:opacity-100 group-focus-visible/mark:scale-100 group-focus-visible/mark:opacity-100",
          )}
        >
          <span className="block">
            {quantity} available to sleeve{location}
          </span>
          <span className="block text-ink-muted">Click to add</span>
        </span>

        <span
          className={cx(
            "font-bold leading-none transition-transform duration-200",
            sizeClass,
            GLOW.reachable,
            "group-hover/mark:animate-bounce group-focus-visible/mark:animate-bounce",
          )}
        >
          {GLYPHS.reachable}
        </span>
      </button>
    </form>
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

/** A friend who has this card open for trade — same shape the wish list and
 *  /decks/check already use for the same fact. */
export type FriendSupplyView = { username: string; available: number };

/** The title carries the counts, because "2 of 4" is the follow-up question the
 *  mark always provokes. `spareIn` and `friendSupply` fold in what used to be
 *  a separate "in {location}" tag beside the mark — one place to look instead
 *  of two, and the same hover that already answered "why this colour" now
 *  answers "where from" too. */
function describe(
  entry: EntryState,
  spareIn: readonly string[],
  friendSupply: readonly FriendSupplyView[],
): string {
  const base = `${DECK_STATE_LABELS[entry.state]} — ${entry.sleeved} of ${entry.wanted} sleeved`;
  if (entry.state === "sleeved") return base;
  if (entry.state === "available") {
    const location = spareIn.length > 0 ? ` (${spareIn.join(", ")})` : "";
    return `${base}, ${entry.sleevable} more ready to sleeve${location}`;
  }
  if (friendSupply.length > 0) {
    const parts = friendSupply.map((s) => `${s.username} has ${s.available}`);
    return `${base}, no spare copies in your collection — but ${parts.join(", ")}`;
  }
  return `${base}, no spare copies in your collection or your friends' binders`;
}

export function DeckStateMark({
  entry,
  spareIn = [],
  friendSupply = [],
  size = "sm",
  wishlist,
  sleeveAction,
}: {
  entry: EntryState;
  /** Containers holding a spare copy — only meaningful on an "available" row. */
  spareIn?: readonly string[];
  /** Friends who have this open for trade — only meaningful on a "missing" row. */
  friendSupply?: readonly FriendSupplyView[];
  size?: "sm" | "lg";
  /** The card and deck to add on click — only meaningful on a "missing" row.
   *  `cardName` must be `cards.name` verbatim (not the display name), since
   *  `addWant` looks it up with an exact, case-insensitive match. `onList`
   *  says whether it is already on this deck's wish list (see `cardKey` in
   *  DeckWorkspace — matched by oracle id, not by this printing). */
  wishlist?: { cardName: string; deckId: string; onList: boolean };
  /** The deck, card and server action to sleeve with on click — only
   *  meaningful on an "available" row. `cardId` is any printing's
   *  `scryfall_id` (`sleeveCard` matches by oracle id, not by this exact
   *  printing), and `action`/`pending` are the same `sleeve` useActionState
   *  pair the row's own ⋯ menu already submits to. */
  sleeveAction?: { deckId: string; cardId: string; action: (formData: FormData) => void; pending: boolean };
}) {
  if (entry.state === "missing" && wishlist) {
    return (
      <MissingMark
        label={describe(entry, spareIn, friendSupply)}
        size={size}
        cardName={wishlist.cardName}
        deckId={wishlist.deckId}
        onList={wishlist.onList}
      />
    );
  }

  if (entry.state === "available" && sleeveAction) {
    return (
      <ReachableMark
        label={describe(entry, spareIn, friendSupply)}
        size={size}
        deckId={sleeveAction.deckId}
        cardId={sleeveAction.cardId}
        quantity={entry.sleevable}
        spareIn={spareIn}
        sleeve={sleeveAction.action}
        sleeving={sleeveAction.pending}
      />
    );
  }

  return (
    <StateMark
      tone={DECK_TONES[entry.state]}
      label={describe(entry, spareIn, friendSupply)}
      size={size}
    />
  );
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
