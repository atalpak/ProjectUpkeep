/**
 * Exact hypergeometric probabilities.
 *
 * "What are the odds this hand has 2+ lands" has a closed-form answer — there
 * is no reason to draw ten thousand fake hands to approximate a number that
 * arithmetic gets exactly right, and `cardByTurnOdds` in simulate.ts uses this
 * module instead of the shuffle-and-count simulator for exactly that reason.
 *
 * A 99-card deck's binomial coefficients overflow a naive factorial fast
 * (99! has no business existing as a float), so every coefficient here is
 * accumulated as a sum of logs and exponentiated once at the end, rather than
 * as `n! / (k! * (n-k)!)` computed directly.
 */

/**
 * log(nCk), built as a running sum rather than log(n!) - log(k!) - log((n-k)!)
 * so nothing anywhere near n! is ever materialised.
 */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  const smaller = Math.min(k, n - k);
  let log = 0;
  for (let i = 0; i < smaller; i++) {
    log += Math.log(n - i) - Math.log(i + 1);
  }
  return log;
}

/**
 * Probability of drawing exactly `k` successes when `draws` cards are dealt,
 * without replacement, from a `population` containing `successes` of them —
 * a 7-card opening hand from a 60-card deck with 24 lands, for instance.
 */
export function hypergeometric(k: number, successes: number, population: number, draws: number): number {
  if (k < 0 || k > draws || k > successes) return 0;
  if (draws - k < 0 || draws - k > population - successes) return 0;
  if (draws > population) return 0;

  const logP =
    logChoose(successes, k) + logChoose(population - successes, draws - k) - logChoose(population, draws);
  return Math.exp(logP);
}

/** Probability of `k` or more successes — the number a keep/mulligan decision
 *  actually turns on ("2+ lands"), not the probability of any single count. */
export function atLeast(k: number, successes: number, population: number, draws: number): number {
  let total = 0;
  const upper = Math.min(successes, draws);
  for (let j = Math.max(k, 0); j <= upper; j++) {
    total += hypergeometric(j, successes, population, draws);
  }
  return total;
}

/**
 * The full land-count distribution for an opening hand: index `k` is the
 * probability of exactly `k` lands. Sums to 1 (within floating-point
 * rounding) by construction, since it covers every possible count from 0 to
 * `handSize`.
 */
export function landCountDistribution(lands: number, deckSize: number, handSize: number): number[] {
  const distribution: number[] = [];
  for (let k = 0; k <= handSize; k++) {
    distribution.push(hypergeometric(k, lands, deckSize, handSize));
  }
  return distribution;
}
