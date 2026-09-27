# Deck Completion workspace — development guide

## Why this is the next product bet

Project Upkeep’s distinctive promise is physical collection truth within a
playgroup. The application already has the ingredients for a useful completion
loop, but they live in separate places:

- a deck or pasted list can identify cards that are ready, in another deck, or
  not owned;
- the collection tracks the exact place an available copy lives;
- friends can expose tradable copies;
- the wish list can show friend suppliers; and
- trades can transfer a selected physical copy atomically.

The missing experience is the handoff from **“this deck is short”** to **“here
is the best next action for each shortage.”** This guide proposes that handoff.
It is intentionally not a marketplace, a deck generator, or a generic social
feed.

## Priority and validation assumption

This is proposed as the next major product build after the remaining catalog /
storage work in backlog item 1 and the owner’s physical-device and playgroup
check in item 4. It ranks ahead of “Fits this deck” (item 25): completing a
specific deck turns known collection data into an immediate action, while
recommendations are discovery for an already-formed deck.

The application currently has one real user. There is no usage evidence that
friends will keep trade binders current, so the first release must be valuable
with zero friends and must never imply that a friend will trade a visible card.
The playgroup portion should be judged after at least one friend imports a
tradable binder.

## User experience

On a deck page, replace a vague “N to sleeve” gap with a **Finish this deck**
section. The same result is shown after a user runs Check a list, without
creating a deck.

For every needed Oracle card, allocate owned copies once across the list and
then show exactly one of these states, in action order:

1. **Pull from `<location>`** — a free copy is available in a non-deck
   location. Show quantity and an optional “Sleeve into this deck” action for
   real decks.
2. **Move from `<deck>`** — the owner has a copy, but it is committed to
   another deck. Do not offer a one-click move until the existing deck-list
   implications are made explicit; link to that copy and explain the tradeoff.
3. **Ask `<friend>`** — one or more accepted friends have a matching Oracle
   card in a location they marked tradable. Show “has it open for trade,” not
   their private physical location and not a promise of availability. Link to
   a prefiltered trade draft only after the friend confirms the offered copy.
4. **Add to wants** — nobody known can currently supply it. Pre-fill a
   quantity-aware want, tagged to the deck when it is a saved deck.

Group rows into *Ready to pull*, *Already in another deck*, *Friends may have
it*, and *Still looking*. A summary at the top should use honest language:
“12 ready to pull · 4 in other decks · 3 friends may have · 18 still looking.”
It must never call all unsleeved cards “missing.”

For a pasted list, actions are limited to links and add-to-want: there is no
deck location to sleeve into until the user saves the list as a deck.

## Delivery stages

### Stage 1 — owned-copy completion (the independently valuable release)

- Extract a pure allocation module that consumes list entries, owned stacks,
  and deck commitments and emits deterministic per-Oracle-card outcomes.
- Reuse the existing physical availability rules and locations. A copy can
  satisfy only one requested card across the list; equivalent reprints compete
  for the same allocation.
- Render the grouped results on the saved-deck page and Check a list result.
- For a saved deck, offer the existing sleeve/move flow only when it is safe
  and clear. Do not mutate a deck list merely by completing the physical move.
- Add a one-click, idempotent “Add to wants” action for unresolved cards,
  respecting an existing want rather than creating duplicates.

### Stage 2 — playgroup sourcing (only after a real imported trade binder)

- Feed only unresolved shortages to the existing RLS-gated friend-tradables
  query; do not fetch friend inventory for cards already covered by an owned
  copy.
- Match by Oracle ID, then display printing/finish/language as useful context.
  Do not require an exact printing unless the user explicitly asked for one.
- Add a compact supplier line and a deep link into the existing friend/trade
  surface. No new social permission or location exposure is required.
- Measure response time with a realistic playgroup. If reading every friend’s
  binder is too broad, add a narrow, RLS-safe batched candidate query rather
  than caching user-specific results across accounts.

### Stage 3 — trade preparation (validate before committing)

- Let a user begin a draft trade with the selected shortage prefilled, while
  retaining the existing counter-offer and acceptance flow.
- Keep final ownership changes exclusively in `public.accept_trade`; this
  feature may prefill a proposal, never transfer a card itself.
- Treat a stale/rekeyed/withdrawn supplier row as normal: the trade builder
  must re-read live stock before submission and give a clear recovery message.

## Architecture

Suggested modules:

```text
src/lib/collection/deck-completion.ts       pure allocation and presentation model
src/lib/collection/deck-completion-query.ts minimal owner-scoped reads and locations
src/lib/social/deck-suppliers.ts            candidate-shortage friend matching (stage 2)
src/components/decks/DeckCompletion.tsx     shared presentation for deck and list check
```

The pure module must receive data rather than importing Supabase. That keeps
the difficult invariant—one free copy cannot satisfy two requirements—unit
testable and makes the saved-deck and scratch-list views agree.

Owner collection reads must retain explicit `owner_user_id` filtering: RLS
also intentionally exposes friends’ tradable rows. Friend data remains
RLS-gated and is queried only in the explicitly cross-person Stage 2 path.

## Non-goals

- No marketplace, price comparison, checkout, or “buy” CTA.
- No automatic deckbuilding or card recommendations; item 25 remains a
  separate, later discovery feature.
- No forced unsleeving, location change, or trade acceptance.
- No claim that a friend will trade a card because it is visible.
- No global collection search or background notifications in v1.

## Required tests

1. Two printing variants of one Oracle card cannot consume the same free copy
   twice.
2. A free binder copy is allocated before a committed deck copy.
3. An owned committed copy yields “in another deck,” not “not owned.”
4. Rows remain deterministically ordered when quantities and names tie.
5. Existing wants are reused; the action is idempotent.
6. An owner-scoped candidate query cannot include a friend’s tradable row.
7. A Stage 2 supplier can only be reported through the existing accepted-friend
   and tradable-location policy path.
8. A stale supplier can never create an ownership transfer outside the existing
   trade acceptance RPC.

## Success criteria and decision gate

The Stage 1 release is worthwhile if the owner can take a real deck from a
shortfall to a correct next action without manually searching Collection,
another deck, and Wants. The Stage 2 release is worthwhile only if a real
friend imports a binder and both people can use the supplier line to start a
trade conversation without confusion about what is being offered.

If that playgroup test does not happen, stop after Stage 1. It is a complete,
useful collection-management feature on its own; building notifications or
additional social mechanics before the data exists would be speculation.
