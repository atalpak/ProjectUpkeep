# Project Upkeep — Working Priorities

Running list. Tick items off, reorder freely. Deadline that shapes tiers: **first
demo to the playgroup, ~1 week out.**

**What this product is:** the answer to *"where is this card, among the people I
know?"* — triggered three ways: building a deck, trading at a table, or seeing a
card on YouTube. Deckbuilding is one trigger, not the definition.

**Standing decisions:** trading stays free forever (it is two-sided and it is how
the app spreads); revenue comes from the single-player loop. Moxfield is for
discovery, this app is for reconciliation — do not build a deck editor.

---

## Tier 0 — before the demo

- [ ] **Reset and repopulate your own data** · half a day · *not code*
      Currently 0 locations, 0 decks, 895 unsorted — there is nothing to
      demonstrate. Target state: 2–3 real decks, 2+ containers, one card you own
      4 of with some sleeved and some free, and one deck with a genuinely missing
      card. Export first as a safety net. Time it and note every friction point —
      this is the dry run of the onboarding you are about to ask four people to do.

- [ ] **Import destination default** · ~1 hour
      Defaults to "Unsorted", which is how 895 cards ended up in a pile. Make it
      ask, or make the empty-collection path create a location first. Your friends
      hit this on their first action.

- [ ] **Trim the collection select** · afternoon
      1.74 MB to draw 50 rows. Drop `oracle_text`, `flavor_text`, `card_faces`,
      `keywords` from the table query; `CardPanel` fetches them from
      `/api/cards/[id]`. Note this trades payload for a fetch on panel open — a
      deliberate prefetch being revisited, not a bug.

- [ ] **Rewrite the landing page** · ~2 hours
      Currently leads with what the app doesn't do and never states the hook. Use
      the sentence already on the decks page: *"A deck is a real place a card
      lives. Cards sleeved into one stop counting as available to build with."*
      Add one screenshot of a deck showing sleeved / available / missing.

- [ ] **Two blemishes** · 15 min
      "1 entries unpriced" on the dashboard; the orphaned stat tile in the grid.

**Stretch, only if the reset goes fast:** the connected deck row (below). A
half-built version is worse than narrating it — don't start it on day six.

---

## Tier 1 — structural, before building much more

- [ ] **Deck list invariant test** · ~1 hour
      `deck_cards` is both intended list and record of what's filed, synced
      asymmetrically (auto on add, manual on remove). Already caused one silent
      corruption: a 100-card deck grew to 114 (see migration 20's header). Most-
      revised part of the schema. Test: sleeve every card of an imported 100-card
      list with duplicate printings, assert the list still totals 100.

- [x] **Decouple export from the page** · done 2026-09-04
      `ExportButtons` took the full CSV *and* full decklist as props, both
      inlined into every page render. Now `/api/collection/export` generates on
      click, taking the same filter params. Decks still pass inline (small).
      Measured saving: 1,743KB → 1,692KB — only 3%, not the "large share" I
      predicted. The row JSON is the real weight. Prerequisite for pagination
      regardless, since a paginated page no longer holds the rows.

- [ ] **Move filtering and pagination into SQL** · in progress
      - [x] `collection_entries` view (migration 24) + RLS non-bypass schema test
      - [x] `isSqlOnly` / `textTerms` in filters.ts; `matchesText` now shares
            `textTerms` so query and in-memory pass cannot drift
      - [x] sort persistence: localStorage → cookie, URL param overrides
      - [x] `getCollection` against the view: SQL filters, order, range, exact
            count, plus `allIds` so select-all still spans the whole filtered set
      - [x] `CollectionTable`: sort and page become props + navigation
      - [x] applied to the database and measured 2026-09-04
      - [x] availability query also scoped to the page (was reading the whole
            collection to draw 50 rows — same problem, different query)

      **Result on a 688-entry collection:** page weight 1,743KB → 340KB (-80%),
      transferred 248KB → 50KB (-80%), server response ~1,424ms → ~1,158ms
      median. Verified: sort asc/desc, page continuity, colour sort (the
      in-memory fallback), filtering counts, export, and every other page.
      `getCollection` fetches up to `MAX_ROWS` and filters in memory — a hard cap
      on serviceable collection size and the reason the page is heavy. Cheaper to
      fix now than after more is built on it. Supersedes the field trim above if
      you do it first.

---

## Tier 2 — the core loop, after the demo

These four are **one query surfaced in four places**: *who near me has this card?*
Today there are three overlapping partial implementations —
`locateInCollection` (yours only), `matchWants` (want list × friends' binders),
and deck-state reconciliation. Build the shared resolver as part of whichever of
these you do first, and design it to serve the rest.

- [ ] **"Check this list" scratch mode** · medium · *the front door*
      Paste a Moxfield list → immediately see how many you have free, how many are
      sleeved elsewhere, what's missing, and who has the missing ones. **Without
      creating a deck** — with a "save as deck" button if you decide to build it.
      Matches the real day-one behaviour; browsing five decks on a Sunday should
      not leave five junk decks behind. Parsing, reconciliation and matching all
      already exist and are tested — what's missing is running them without
      persisting.

- [ ] **Connected deck row** · small–medium · *subset of the above*
      A missing row should read: *not available — Sarah has one in Trade Binder —
      or buy: TCGplayer / Card Kingdom.* Three data sources you already have, one
      row. This is the screenshot that explains the product.

- [ ] **Want-list match notifications** · medium · *the retention mechanic*
      The wish list is currently pull-only; notification types are `friend_*` and
      `trade_*` with no want-match. "Check again in a few weeks" is a workaround
      for a missing push. Trigger on `card_instances` checking tradable location ×
      friends' want lists — same discipline as migration 14.
      **Trap: batch it.** Fires per card inserted, so a friend importing 2,000
      cards would bury you in alerts on the exact day they onboard.

- [ ] **Friends' copies in search results** · medium
      Header search answers "do I have it" well. The "or anyone" half doesn't
      exist — `card-actions` and `locateInCollection` are own-collection only.
      Completes the YouTube moment.

- [ ] **Trade → location assignment on acceptance** · medium
      Transfer moves ownership; cards land nowhere. Your original irritation was
      "hit a button and the inventory moves" — right now the button moves it into
      limbo. Prompt with a default and a "sort later" escape hatch feeding the
      unsorted count.

---

## Tier 3 — conditional, after real usage

- [ ] **Dashboard reframe** — currently leads with inventory stats (value, count,
      unsorted). The product's question is "what can I build, who has what I
      want." Wait until the demo so their reaction shapes it.
- [ ] **Import reads a per-row location column** — would remove the biggest
      onboarding tax. Sized by whether ManaBox can export per binder.
- [ ] **Navigation / IA** — ten destinations, with Find / header search / Wants
      overlapping. Change this *after* watching someone fail to find something.
- [ ] **PWA shell + offline fallback** — matters at an LGS, not at a kitchen table.
- [ ] **Self-service account delete** — before charging anyone money.

---

## Deferred deliberately

- **Card scanner + native app.** The pack-opening case is far easier than general
  scanning (known set, new cards, printed collector numbers), and native iOS gets
  free on-device OCR via the Vision framework. But it's a second codebase and a
  hard CV problem, and ManaBox does it well and free. **Ride their scanner:** scan
  → export CSV → import here to a location. Run that once for real before building
  anything. Revisit when someone other than you asks for it.
- **Safety work** (rate limiting, block/report, privacy controls). Justified when
  strangers can reach each other; with four friends it isn't yet. Before any
  public beta.
- **Trade circles / playgroups.** Only if usage says 1:1 friendship is the wrong
  unit.
- **A deck editor, OCR-as-differentiator, multi-vendor pricing, multi-TCG.** Not
  fights worth picking.
