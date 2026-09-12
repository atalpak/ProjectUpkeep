/**
 * The goldfishing loop: shuffle, open a hand, mulligan by the keep rule, then
 * play forward turn by turn and see what happens.
 *
 * This does not simulate a game of Magic. There is no opponent, no combat, no
 * choice of what to do with mana beyond "cast something if you can" — it
 * simulates *draws and mana*, because that is the one thing goldfishing a
 * decklist can actually measure without a rules engine. Two simplifications
 * follow from that, both deliberate:
 *
 *   - A drawn nonland is never "used up." Real play would remove a cast
 *     spell from hand, but this app has no board state to put it on, so every
 *     nonland seen stays in a running pool and is re-checked for castability
 *     every later turn. That is exactly what the headline numbers need:
 *     `castByTurn` asks whether *something* was payable by then, and
 *     `colorScrewRate` asks whether something is *still* stuck unpayable at
 *     the end. Because lands never leave play, the set of payable colours
 *     only grows turn over turn, so a spell that was castable on turn 3 stays
 *     castable at turn `turns` — the pool never produces a false "still
 *     stuck" for a spell that was fine earlier.
 *   - Land drops choose the untapped land that adds the most colours not
 *     already in play, breaking ties by draw order. A real player sequences
 *     lands for colour too, so this is the same "assume competent play"
 *     spirit as `keep.ts`'s keep rule, not a new liberty — it means
 *     `colorScrewRate` measures the mana base, not bad land-play order.
 *
 * Mulligans use the London rule (draw a fresh 7 every time, bottom cards
 * only once you keep) and the simulated player never mulligans past 3 — past
 * that point real players keep whatever they have rather than risk a 3-card
 * hand, and capping the loop is also what keeps a deck that can never
 * satisfy the keep rule (the 0-land and 60-land invariant tests) from
 * spinning forever. `mulliganDistribution`'s "3+" bucket is exactly this
 * cap, not a genuinely open-ended tail.
 */

import { evaluateHand, type KeepRule } from "@/lib/playtest/keep";
import type { PlaytestCard } from "@/lib/playtest/library";
import { canPay, type Color } from "@/lib/playtest/mana";
import { atLeast } from "@/lib/playtest/odds";
import { mulberry32, shuffle } from "@/lib/playtest/rng";

const OPENING_HAND_SIZE = 7;
const MAX_MULLIGANS = 3;

/**
 * What `simulate` draws from. Deliberately not just `PlaytestCard[]`: the
 * commander is tracked separately from the library by `buildLibrary` (it is
 * never drawn), and `commanderTurn` needs it. `cardByTurnOdds` below takes a
 * plain `PlaytestCard[]` instead, since a named card's odds are a property of
 * the library alone and the commander is never a card you draw toward.
 */
export type SimDeck = {
  library: PlaytestCard[];
  commander: PlaytestCard | null;
};

export type SimulateOptions = {
  /** How many games to goldfish. 10,000 should run comfortably in a browser. */
  hands: number;
  /** How many turns to play each game forward. */
  turns: number;
  onThePlay: boolean;
  rule: KeepRule;
  /** Same seed, same sequence of hands — see rng.ts. */
  seed: number;
};

export type MulliganDistribution = { "0": number; "1": number; "2": number; "3+": number };

export type CommanderTurnDistribution = {
  /** Share of games whose *first* payable turn for the commander was `turn`
   *  (index `turn - 1`) — a distribution, not a cumulative curve. */
  byTurn: number[];
  /** Share of games where the commander was never payable within `turns`. */
  never: number;
};

export type SimulateStats = {
  keepRate: number;
  mulliganDistribution: MulliganDistribution;
  /** Index `k` = share of games whose opening seven (before any mulligan)
   *  held exactly `k` lands. */
  openingLandDistribution: number[];
  /** `landsByTurn[turn - 1][n - 1]` = share of games with at least `n` lands
   *  in play at that turn. Row `turn - 1` has length `turn`, since at most
   *  one land enters play per turn. */
  landsByTurn: number[][];
  /** Share of games where, by the final turn, some nonland card seen is held
   *  unpayable purely for colour — enough total mana, wrong colours. */
  colorScrewRate: number;
  /** Cumulative: share of games that had cast at least one spell by each turn. */
  castByTurn: number[];
  commanderTurn: CommanderTurnDistribution | null;
};

/**
 * Which card in `hand` to bottom, and which to keep, when `count` cards must
 * go to the bottom of the library after a London mulligan.
 *
 * Policy: shed lands back toward the keep rule's own band first (there is no
 * point holding a mulliganed hand to a stricter land count than the rule that
 * decided it needed mulliganing), then shed the most expensive remaining
 * spells — a card you cannot cast soon does less for a hand than one you can.
 * Lands have cmc 0, so once the excess-land phase is done this naturally
 * stops touching lands unless there is nothing else left to bottom.
 */
function bottomCards(
  hand: PlaytestCard[],
  count: number,
  rule: KeepRule,
): { kept: PlaytestCard[]; bottomed: PlaytestCard[] } {
  if (count <= 0) return { kept: hand, bottomed: [] };

  const kept = [...hand];
  const bottomed: PlaytestCard[] = [];
  let toRemove = count;

  let landExcess = Math.max(0, kept.filter((c) => c.land).length - rule.maxLands);
  while (toRemove > 0 && landExcess > 0) {
    const idx = kept.findIndex((c) => c.land);
    if (idx === -1) break;
    bottomed.push(kept.splice(idx, 1)[0]);
    toRemove--;
    landExcess--;
  }

  while (toRemove > 0 && kept.length > 0) {
    let worst = 0;
    for (let i = 1; i < kept.length; i++) {
      if (kept[i].cmc > kept[worst].cmc) worst = i;
    }
    bottomed.push(kept.splice(worst, 1)[0]);
    toRemove--;
  }

  return { kept, bottomed };
}

/** Index of the pool card that adds the most colours not already in `inPlay`,
 *  ties broken toward the one drawn/held first. */
function chooseLandIndex(pool: PlaytestCard[], inPlay: PlaytestCard[]): number {
  const have = new Set<Color>();
  for (const land of inPlay) for (const c of land.produces) have.add(c);

  let bestIdx = 0;
  let bestNew = -1;
  for (let i = 0; i < pool.length; i++) {
    const newColors = pool[i].produces.filter((c) => !have.has(c)).length;
    if (newColors > bestNew) {
      bestNew = newColors;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function simulate(deck: SimDeck, opts: SimulateOptions): SimulateStats {
  const { hands, turns, onThePlay, rule, seed } = opts;
  const rng = mulberry32(seed);

  // Reshuffled in place every game rather than rebuilt — see the module
  // header on rng.ts for why that matters at 10,000 iterations.
  const scratch = deck.library.slice();

  const mulliganCounts = [0, 0, 0, 0];
  const openingLandCounts = new Array(OPENING_HAND_SIZE + 1).fill(0);
  const landsByTurnCounts: number[][] = Array.from({ length: turns }, (_, t) => new Array(t + 1).fill(0));
  const castByTurnCounts = new Array(turns).fill(0);
  const commanderTurnCounts = deck.commander ? new Array(turns).fill(0) : null;
  let commanderNever = 0;
  let kept = 0;
  let colorScrewCount = 0;

  // Reused across games; cleared with `.length = 0` rather than reallocated.
  const inPlay: PlaytestCard[] = [];
  const handLandsPool: PlaytestCard[] = [];
  const spellsSeen: PlaytestCard[] = [];

  for (let game = 0; game < hands; game++) {
    shuffle(scratch, rng);
    let mullCount = 0;
    let hand = scratch.slice(0, OPENING_HAND_SIZE);
    const openingLands = hand.filter((c) => c.land).length;
    let evaluation = evaluateHand(hand, rule);

    while (!evaluation.keep && mullCount < MAX_MULLIGANS) {
      mullCount++;
      shuffle(scratch, rng);
      hand = scratch.slice(0, OPENING_HAND_SIZE);
      evaluation = evaluateHand(hand, rule);
    }

    mulliganCounts[Math.min(mullCount, 3)]++;
    openingLandCounts[openingLands]++;
    if (evaluation.keep) kept++;

    const { kept: finalHand, bottomed } = bottomCards(hand, mullCount, rule);
    // The cards not drawn into this attempt's 7, followed by whatever got
    // bottomed — i.e. actually on the bottom of the library, not shuffled
    // back in. Games are short enough relative to a 60-99 card deck that the
    // bottomed cards are never reached anyway.
    const remainingLibrary = scratch.slice(OPENING_HAND_SIZE).concat(bottomed);
    let drawIndex = 0;

    inPlay.length = 0;
    handLandsPool.length = 0;
    spellsSeen.length = 0;
    for (const card of finalHand) {
      if (card.land) handLandsPool.push(card);
      else spellsSeen.push(card);
    }

    let hasCast = false;
    let commanderFirstTurn: number | null = null;

    for (let turn = 1; turn <= turns; turn++) {
      // On the play skips the draw step on turn 1; on the draw does not.
      const drawsThisTurn = turn === 1 && onThePlay ? 0 : 1;
      for (let d = 0; d < drawsThisTurn && drawIndex < remainingLibrary.length; d++) {
        const card = remainingLibrary[drawIndex++];
        if (card.land) handLandsPool.push(card);
        else spellsSeen.push(card);
      }

      if (handLandsPool.length > 0) {
        const idx = chooseLandIndex(handLandsPool, inPlay);
        inPlay.push(handLandsPool[idx]);
        handLandsPool.splice(idx, 1);
      }

      const sources = inPlay.map((c) => c.produces);

      for (let n = 1; n <= turn; n++) {
        if (inPlay.length >= n) landsByTurnCounts[turn - 1][n - 1]++;
      }

      if (!hasCast) {
        for (const spell of spellsSeen) {
          if (canPay(spell.cost, sources)) {
            hasCast = true;
            break;
          }
        }
      }
      if (hasCast) castByTurnCounts[turn - 1]++;

      if (commanderTurnCounts && deck.commander && commanderFirstTurn === null) {
        if (canPay(deck.commander.cost, sources)) commanderFirstTurn = turn;
      }

      if (turn === turns) {
        for (const spell of spellsSeen) {
          if (inPlay.length >= spell.cmc && !canPay(spell.cost, sources)) {
            colorScrewCount++;
            break;
          }
        }
      }
    }

    if (commanderTurnCounts) {
      if (commanderFirstTurn !== null) commanderTurnCounts[commanderFirstTurn - 1]++;
      else commanderNever++;
    }
  }

  return {
    keepRate: kept / hands,
    mulliganDistribution: {
      "0": mulliganCounts[0] / hands,
      "1": mulliganCounts[1] / hands,
      "2": mulliganCounts[2] / hands,
      "3+": mulliganCounts[3] / hands,
    },
    openingLandDistribution: openingLandCounts.map((n) => n / hands),
    landsByTurn: landsByTurnCounts.map((row) => row.map((n) => n / hands)),
    colorScrewRate: colorScrewCount / hands,
    castByTurn: castByTurnCounts.map((n) => n / hands),
    commanderTurn: commanderTurnCounts
      ? { byTurn: commanderTurnCounts.map((n) => n / hands), never: commanderNever / hands }
      : null,
  };
}

/**
 * Chance of having drawn at least one of `successes` copies from a library of
 * `population` cards, by each turn — computed exactly rather than by
 * simulation, see odds.ts. `result[i]` is the odds by turn `i + 1`.
 *
 * The shared machinery behind `cardByTurnOdds` below (a named card, matched
 * by key) and the card-odds picker's "any single copy" figure: a singleton
 * deck's one-ofs all have `successes = 1` over the same `population`, so
 * they share this exact number — no need for the caller to hold an actual
 * one-copy card just to ask what the odds would be if it did.
 */
export function copiesByTurnOdds(
  successes: number,
  population: number,
  turns: number,
  onThePlay: boolean,
): number[] {
  const odds: number[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    const cardsSeenBy = Math.min(population, OPENING_HAND_SIZE + turn - (onThePlay ? 1 : 0));
    odds.push(atLeast(1, successes, population, cardsSeenBy));
  }
  return odds;
}

/**
 * Chance of having drawn a specific card (matched by `PlaytestCard.key`, so
 * every printing of it counts) by each turn. `turns[i]` in the result is the
 * odds by turn `i + 1`.
 */
export function cardByTurnOdds(
  deck: PlaytestCard[],
  cardKey: string,
  turns: number,
  onThePlay: boolean,
): number[] {
  const successes = deck.filter((c) => c.key === cardKey).length;
  return copiesByTurnOdds(successes, deck.length, turns, onThePlay);
}
