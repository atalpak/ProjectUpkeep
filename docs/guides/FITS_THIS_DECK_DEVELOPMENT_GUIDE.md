# Project Upkeep: “Fits This Deck” Development Guide

## Purpose

Add a Commander-focused recommendation section that identifies cards a user already owns and could realistically add to a specific deck.

The feature should answer:

> “Which cards in my collection fit this deck, why do they fit, and where can I find them?”

This is not a deck generator, power-level calculator, or EDHREC clone. It is a collection-aware suggestion tool.

Built From Bulk demonstrates the appealing product loop: collection → build → improve as the collection changes. Upkeep should borrow that loop while remaining centered on its stronger data: physical availability, deck commitments, and collection locations. [Built From Bulk](https://builtfrombulk.com/)

## User experience

Add a section near the top of a Commander deck’s detail page, beneath the deck banner.

### Section layout

**Fits this deck**  
*Cards in your collection that could strengthen this deck.*

Show 6 recommendations by default. Each card includes:

- Card image, name, mana cost, and location
- Status: “Available in Green Binder” or “2 copies available”
- One or two concrete reasons it was recommended
- **Add to decklist** action
- **Not for this deck** action, initially optional

Example:

> **Academy Manufactor**  
> Available in Artifact Box  
> - Works with your commander: it strengthens Treasure and artifact-token creation.  
> - Supports this deck’s theme: 7 cards already create Tokens.  
> `[Add to decklist] [Not for this deck]`

Do not display an opaque numerical “fit score.” Ranking is internal; the user should see reasons, not a supposedly objective judgment.

### Empty states

- Non-Commander deck: do not show the section.
- Commander deck with no nominated commander: show “Choose a commander to see collection-aware suggestions.”
- No qualifying cards: show “No clear matches in your available collection yet.”
- All likely cards are already committed to other decks: optionally show a secondary “Worth moving from another deck” link later, but do not include these in the initial recommendations.

## Scope

### Included in v1

- Commander decks with exactly one nominated commander
- Cards owned by the current user with at least one copy not currently sleeved in another deck
- Color-identity and Commander-legality filtering
- Exclude cards already present in the deck, including different printings of the same Oracle card
- Deterministic, explainable scoring
- “Add to decklist” action only; do not automatically move a physical copy
- Six ranked recommendations

### Explicitly excluded from v1

- Automatically generating or replacing a 99-card deck
- EDHREC scraping or dependence on an undocumented external API
- AI-generated recommendations or explanations
- Partner, Background, Doctor’s Companion, and other multi-commander edge cases
- Power-level or bracket analysis
- Recommendations based on friends’ collections
- “Best card” claims

## Existing data available in Upkeep

The current application already has most of what this feature needs.

| Requirement | Existing source |
|---|---|
| Deck and Commander | `locations`, including `commander_card_id` |
| Intended decklist | `deck_cards` |
| Physical ownership and quantity | `card_instances` |
| Whether a copy is free or committed | `locations.type`; cards in locations of type `deck` are committed |
| Card identity across printings | `cards.oracle_id` |
| Card text and tags | `cards.oracle_text`, `keywords`, `type_line` |
| Color identity and mana data | `cards.color_identity`, `mana_cost`, `cmc`, `produced_mana` |
| Existing deck analytics | curve, color spread, and type sections |
| Location names | `locations.name` |

Relevant existing implementation:

- [Deck detail page](src/app/(app)/decks/[id]/page.tsx)
- [Availability rules](src/lib/collection/availability.ts)
- [Deck statistics](src/lib/collection/deck-stats.ts)
- [Collection and deck queries](src/lib/collection/queries.ts)

## Required data change

### Store Commander legality

Upkeep currently stores Scryfall card details but does not appear to persist Scryfall’s `legalities` object. Add it before enabling the feature.

Recommended migration:

```sql
alter table public.cards
  add column if not exists legalities jsonb;
```

Update the Scryfall sync mapping so `cards.legalities` receives Scryfall’s legalities object. Eligibility should require:

```ts
card.legalities?.commander === "legal"
```

This avoids recommending banned or otherwise illegal cards.

A smaller alternative is storing only `commander_legal boolean`, but keeping the full legalities object is more useful for future format-aware features.

### Optional later data change: dismissed suggestions

Do not block v1 on this. If “Not for this deck” is included, create:

```sql
create table public.deck_recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references public.locations(id) on delete cascade,
  card_oracle_id uuid not null,
  action text not null check (action in ('dismissed')),
  created_at timestamptz not null default now(),
  unique (deck_id, card_oracle_id, action)
);
```

Enable RLS and restrict access to the owning user. A dismissed Oracle ID must not reappear for that deck.

## Recommendation pipeline

Create a pure module:

```text
src/lib/recommendations/deck-fit.ts
```

It should accept:

- the nominated commander
- current deck entries
- all available owned candidate cards
- computed deck statistics
- optional user-selected deck themes in a future release

It should return:

```ts
type DeckRecommendation = {
  card: CandidateCard;
  score: number; // internal only
  reasons: string[];
  available: number;
  locations: string[];
};
```

Keep this function database-independent and fully unit tested.

### Step 1: Candidate pool

Load the current user’s owned cards, grouped by Oracle ID.

For each canonical card, calculate:

- total owned quantity
- quantity currently committed to any deck
- available quantity
- free-copy locations
- a representative available printing to add to the decklist

Only include a candidate if:

1. The user has at least one available copy.
2. The card is not already in the target deck, compared by Oracle ID.
3. The card’s color identity is a subset of the commander’s color identity.
4. The card is Commander legal.
5. The card is not the commander itself.

A printing does not matter for eligibility: any printing of the same Oracle card represents the same playable card.

### Step 2: Identify useful traits

Start with a small, controlled vocabulary. Do not attempt to infer every Commander archetype.

Suggested initial traits:

- artifacts
- Treasure
- tokens
- +1/+1 counters
- sacrifice
- graveyard
- lands / landfall
- instants and sorceries
- creatures
- lifegain

Detect a trait from the commander’s Oracle text and from the current deck’s Oracle text. Use explicit text patterns and keywords in one centralized rules file.

Examples:

| Trait | Example matching signals |
|---|---|
| Artifacts | “artifact”, “artifact token” |
| Treasure | “Treasure” |
| Tokens | “create a … token” |
| Counters | “counter”, “proliferate” |
| Sacrifice | “sacrifice” |
| Graveyard | “graveyard”, “mill”, “return … from your graveyard” |
| Lands | “landfall”, “additional land”, “search your library for a land” |
| Spells | “instant or sorcery”, “whenever you cast” |

A trait should be considered an established deck theme only when it appears in the commander or across a minimum number of existing deck cards. This avoids suggesting generic cards based on a single incidental mention.

### Step 3: Identify structural gaps

Use modest, explainable role detection:

- **Ramp:** mana-producing text, mana rocks, land-ramp effects
- **Card draw:** “draw”
- **Removal:** “destroy target,” “exile target,” “counter target”
- **Lands:** `Land` in the type line

Suggested initial thresholds for a 100-card Commander deck:

- Fewer than 35 lands: land recommendations may be relevant
- Fewer than 8 ramp cards: early-ramp recommendations may be relevant
- Fewer than 8 card-draw cards: card-draw recommendations may be relevant
- Fewer than 8 interaction cards: removal recommendations may be relevant

These are prompts, not correctness claims. Phrase copy as “adds another early ramp option,” not “your deck must play this card.”

### Step 4: Score candidates

Use a transparent weighted score. The exact numbers can be tuned later.

| Signal | Suggested weight |
|---|---:|
| Direct commander trait match | +40 |
| Established deck-theme match | +20 per matching trait, maximum +40 |
| Fills a detected role gap | +25 |
| Good early-game mana value for an identified gap | +10 |
| Available copy is in a non-deck location | required, not a bonus |
| Already in the deck | exclude |
| Color identity or legality mismatch | exclude |

Use deterministic tie-breakers:

1. More explanatory reasons
2. More available copies
3. Lower mana value
4. Alphabetical name

### Step 5: Generate explanations

Each displayed reason must map directly to a scoring rule. Never generate generic copy such as “This is a powerful card.”

Good:

- “Supports your commander’s artifact plan.”
- “Creates Treasure, a theme already present in this deck.”
- “Adds early ramp; this deck currently has five ramp cards.”
- “Available in Green Binder.”

Bad:

- “High synergy.”
- “A staple.”
- “Improves your power level.”
- “Recommended by our algorithm.”

## UI and mutation behavior

Create a presentational component, for example:

```text
src/components/decks/DeckRecommendations.tsx
```

The deck page should load recommendation data server-side alongside its existing deck, availability, and decklist queries.

Use the existing “add card to decklist” action. Adding a suggestion should:

1. Add the candidate’s representative printing to `deck_cards`.
2. Revalidate the deck route.
3. Remove the card from recommendations because it is now already in the deck.
4. Not move a physical card into the deck automatically.

The user should separately choose when to sleeve the physical copy. This preserves Upkeep’s distinction between an intended decklist and physical card location.

## Performance and security requirements

- Perform all recommendation computation on the server.
- Never send the user’s full collection to the browser merely to rank six cards.
- Select only fields needed for candidate scoring and rendering.
- Group by Oracle ID before scoring so reprints do not produce duplicate suggestions.
- Respect existing RLS policies; never use service-role credentials for this feature.
- Do not cache recommendations across users.
- Recompute after decklist changes or collection-location changes so availability remains accurate.

For very large collections, optimize the candidate query before introducing caching. The result is user-specific and changes whenever a card is moved, added, or removed.

## Test requirements

Add unit tests for the pure recommendation module.

Required cases:

1. A card outside commander color identity is excluded.
2. A Commander-illegal card is excluded.
3. A card already present under a different printing is excluded.
4. A card with no available copy is excluded.
5. A free copy in a binder is eligible.
6. A commander-text trait produces the correct explanation.
7. A deck-level trait requires the minimum evidence threshold.
8. A role-gap recommendation produces the correct explanation.
9. Results are stable and deterministically ordered.
10. Recommendations never include more than the configured display limit.

Add database or integration coverage for the candidate query to ensure users cannot see another user’s collection data.

## Acceptance criteria

The feature is complete when:

- A Commander deck with a nominated commander displays up to six available, legal, color-compatible collection cards.
- Every card has at least one accurate, understandable reason.
- No candidate is already in the deck, including reprints.
- No candidate is currently committed to another deck.
- The UI identifies where the available copy is stored.
- “Add to decklist” changes only the intended decklist, not the physical card location.
- Recommendations update after the decklist or collection changes.
- No EDHREC data, web scraping, AI generation, or third-party recommendation feed is required.

## Future extensions

After v1 has been used and evaluated, consider:

- Dismissed-card preferences
- “Worth moving from another deck” as a separate, explicit section
- User-selected deck themes using controlled tags
- Friend trade-binder matches for missing cards
- Combo suggestions from an authorized Commander Spellbook integration
- Licensed community-recommendation data as one signal among the local signals

The product principle should remain constant:

> Upkeep recommends cards because they fit this player’s deck and collection reality—not simply because they are popular cards online.
