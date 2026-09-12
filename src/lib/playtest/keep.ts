/**
 * The keep/mulligan call for one opening hand.
 *
 * This is a heuristic, not a rules engine, and it is worth being plain about
 * what it does not see: it never models ramp, fetch lands, an MDFC land held
 * as a land, card selection (a cantrip that could dig for the missing
 * colour), or anything the deck draws after the hand it is judging. It also
 * assumes lands get played in the order they sit in the hand array, not the
 * order a sharp player would sequence them for colour — see `firstCastableTurn`
 * below. All of that makes this a lower bound on how playable a hand really
 * is, never an upper one, which is the direction to be wrong in for a tool
 * whose job is to flag inconsistency. The UI states the rule it used; this
 * file must not pretend the rule is smarter than it is.
 */

import { canPay } from "@/lib/playtest/mana";
import type { PlaytestCard } from "@/lib/playtest/library";

export type KeepRule = {
  minLands: number;
  maxLands: number;
  /** Reject a hand with no nonland payable by this turn. `null` skips the
   *  castability check entirely and judges on land count alone. */
  requireCastableByTurn: number | null;
};

/**
 * 60-card decks and Commander decks warrant different bands: Commander plays
 * a 99-card deck to the same 7-card hand, so it needs more lands in that hand
 * to reach the same density, and it tolerates a wider spread because a
 * flooded or screwed game is harder to recover from over Commander's longer
 * turns.
 */
export function defaultKeepRule(deckSize: number): KeepRule {
  if (deckSize >= 99) return { minLands: 3, maxLands: 6, requireCastableByTurn: 3 };
  return { minLands: 2, maxLands: 5, requireCastableByTurn: 3 };
}

export type HandEvaluation = {
  lands: number;
  keep: boolean;
  reason: "ok" | "too-few-lands" | "too-many-lands" | "no-castable-spell";
  /** The earliest turn some nonland in hand becomes payable, playing lands in
   *  hand order — null if none ever does within the search horizon. */
  castableByTurn: number | null;
};

/**
 * The first turn, playing one land per turn *in the order the hand lists
 * them*, that some nonland card in the hand is payable.
 *
 * Not "the best possible sequencing" — a real player would hold back a land
 * to hit a colour a turn sooner where it matters, and this does not model
 * that. Search is capped at `maxTurn` regardless of how many lands are in
 * hand, so a hand with no lands at all still gets checked for a card free to
 * cast (Ornithopter, a 0-cost artifact) starting turn 1.
 */
function firstCastableTurn(hand: PlaytestCard[], maxTurn: number): number | null {
  const lands = hand.filter((c) => c.land);
  const spells = hand.filter((c) => !c.land);

  for (let turn = 1; turn <= maxTurn; turn++) {
    const inPlay = lands.slice(0, Math.min(turn, lands.length));
    const sources = inPlay.map((c) => c.produces);
    for (const spell of spells) {
      if (canPay(spell.cost, sources)) return turn;
    }
  }
  return null;
}

export function evaluateHand(hand: PlaytestCard[], rule: KeepRule): HandEvaluation {
  const lands = hand.filter((c) => c.land).length;

  if (lands < rule.minLands) {
    return { lands, keep: false, reason: "too-few-lands", castableByTurn: null };
  }
  if (lands > rule.maxLands) {
    return { lands, keep: false, reason: "too-many-lands", castableByTurn: null };
  }

  const horizon = rule.requireCastableByTurn ?? hand.length;
  const castableByTurn = firstCastableTurn(hand, horizon);

  if (rule.requireCastableByTurn !== null && castableByTurn === null) {
    return { lands, keep: false, reason: "no-castable-spell", castableByTurn: null };
  }

  return { lands, keep: true, reason: "ok", castableByTurn };
}
