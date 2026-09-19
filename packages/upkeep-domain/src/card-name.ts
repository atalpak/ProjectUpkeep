/**
 * What to show for a card's name, once a specific printing is in hand — the
 * real game name, plus the printed alternate in parentheses when this
 * printing has one. A Universes Beyond crossover (Marvel, LOTR, Fallout,
 * Final Fantasy, Avatar, the Godzilla alt-arts in Ikoria, ...) prints an
 * in-universe alternate over the real card, and that is what is actually on
 * the piece of cardboard someone is holding — but the real name is still how
 * everyone, including the owner, knows the card, so it leads.
 *
 * Only for a resolved printing (collection rows, deck rows, a chosen
 * printing in the add-card flow). Search suggestions, which are grouped by
 * real name across every printing, show `name` alone — see the search route.
 *
 * Takes a loose shape rather than `Card` so it works on every ad-hoc select
 * (dashboard "most valuable," locate, wants, ...) that only pulls a few
 * columns, not the full row.
 */
export function cardDisplayName(card: { name: string; flavor_name?: string | null }): string {
  return card.flavor_name ? `${card.name} (${card.flavor_name})` : card.name;
}
