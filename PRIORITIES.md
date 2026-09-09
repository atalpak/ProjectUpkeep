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

- [x] **Reset and repopulate your own data** · done 2026-09-07

      Went from 895 cards / 688 entries / 0 locations / 0 decks to a collection
      that actually demonstrates the product. ManaBox does export per binder, so
      the per-container import path was used, not the unsorted-fallback.

      Found and fixed two real bugs along the way, both shipped to production:
      - Export was silently truncating to 50 rows (`getCollection` defaults to
        paginated; the export route never passed `paginate: false` despite its
        own comment claiming otherwise) — the "safety net" backup would have
        quietly only backed up 50 of 688 entries.
      - Bulk delete/move/set-field failed outright above ~500 selected rows:
        Supabase encodes `.in()` filters into the request URL, and at that size
        it exceeds the gateway's length limit. Now batches ids into chunks of
        200 in `bulk-actions.ts`.
      - Also found: `trade_items.card_instance_id` was `ON DELETE RESTRICT`,
        so a card that had ever been part of any trade — open, declined, or
        completed years ago — could never be deleted or moved. Fixed
        2026-09-07 (migration 25): the column is now nullable with
        `ON DELETE SET NULL`; trade history keeps its own snapshot (migration
        23) so nothing is lost. Verified by deleting the one entry ("Snap")
        this had blocked.
      - Still separately open: deleting a `trades` row itself (not a card) is
        impossible once it has `ownership_history` — the `ON DELETE SET NULL`
        cascade on `ownership_history.trade_id` collides with its append-only
        trigger. Lower priority: nothing in the app hard-deletes a trade today.

      **Result:** 7 locations (3 decks, 4 boxes), 895 of 896 cards filed. All
      four demo targets hit: 3 decks filled at real Commander size; 4 non-deck
      containers; a new deck ("F#$k You, Pay Me") with 2 of 95 sleeved and 67
      cards genuinely missing; and Swamp split 2 sleeved / 19 free across
      locations — the single-screen pitch.

      **Still open:** trade binder was never designated or marked tradable —
      skipped this pass, needed before the social half works.

- [x] **Import destination default** · done 2026-09-08
      `LocationSelect` silently defaulted to "Unsorted" — how the original
      895-card collection ended up in a pile. Went with "ask": a new
      `requireChoice` mode starts the importer's destination picker on a
      disabled "Choose where these go…" placeholder; "Unsorted" is still a
      normal, always-selectable option, just no longer the unattended one.
      Import stays disabled with an inline hint until a real choice is made.
      Scoped to the importer only — `AddCardForm` and other `LocationSelect`
      callers keep defaulting to Unsorted, since one manual add is a much
      smaller blast radius than an import that can silently file hundreds of
      cards. Verified live.

- [ ] **Trim the collection select** · afternoon
      1.74 MB to draw 50 rows. Drop `oracle_text`, `flavor_text`, `card_faces`,
      `keywords` from the table query; `CardPanel` fetches them from
      `/api/cards/[id]`. Note this trades payload for a fetch on panel open — a
      deliberate prefetch being revisited, not a bug.

- [x] **Design system & brand identity** · done 2026-09-08 · supersedes the old "rewrite the
      landing page" item — the copy fix below is now step one of a bigger pass

      **Why now:** early viewers said the app "looks like AI slop" — like
      Claude or another AI produced it, not like a considered product. That
      diagnosis is accurate and specific, not just vibes:
      - The accent color (`#4f5ecb` light / `#828ff2` dark, in `globals.css`)
        is close to the literal default hue every AI-scaffolded SaaS dashboard
        converges on.
      - No custom font anywhere — raw `system-ui` stack. `src/components/ui.tsx`
        applies one border-radius vocabulary (`rounded-md`/`rounded-lg`) to
        every button, card, input and badge alike — the single most
        recognizable "generated, not designed" tell.
      - No shadows, no imagery, no decorative use of the mana-symbol/set-symbol
        components that already exist and work — they are wired up
        functionally but never used for personality.
      - There is no `public/` directory at all: no favicon, no logo, no OG
        image. The only "branding" today is the word "Upkeep" colored with the
        accent token.
      - The token *architecture* underneath (`globals.css`'s semantic
        canvas/surface/border/ink/accent variables, light+dark) is genuinely
        well-built — this is a re-skin of good bones, not a rebuild.

      **Direction, decided 2026-09-08:** playful/hobbyist, not premium or
      utilitarian — closer to game-night energy than a finance app. Kept the
      name "Project Upkeep" as-is.

      - [x] **Fast pass** · done 2026-09-08 — palette, type, mark, favicon,
            shipped to production. Full diff: `src/app/globals.css`,
            `src/app/layout.tsx`, `src/components/ui.tsx`,
            `src/components/Wordmark.tsx` (new), `src/app/icon.svg` (new),
            `src/app/opengraph-image.tsx` (new).
            - **Palette:** off the cool indigo entirely. Warm marigold/amber
              accent (`#d98a2c` light / `#f2a93c` dark — close to but not
              identical to the values first proposed, tuned for contrast) over
              a warm parchment canvas and a warm charcoal-green ink, both
              modes. Reads like a card binder, not a dashboard.
            - **Type:** Baloo 2 (rounded, game-box display face) for headings
              and the big dashboard numbers, Plus Jakarta Sans for body and
              dense tables, both via `next/font` — self-hosted, no external
              request. Previously: raw `system-ui`, no custom font at all.
            - **Shape:** buttons and badges are now pill-shaped; cards and
              empty-states got a more generous radius; inputs stayed crisp and
              rectangular (the collection table still needs the density).
            - **Mark:** a logomark — a stylized card with a checkmark badge,
              "a card that's been accounted for" — replacing the plain
              colored-text wordmark, via a shared `Wordmark` component used in
              the header, nav drawer, and landing page.
            - **Assets:** a real favicon and a generated OG image now exist;
              there was no `public/` directory at all before this. Also set
              `metadataBase` so the OG image resolves against the real domain
              in production rather than localhost.

      - [x] **Full systemization** · done 2026-09-08
            - **Shape:** `Banner` was the one primitive left with no shape of
              its own after the fast pass — flat text in a thin border. Now a
              colored left accent bar, a small check/alert glyph, and its own
              radius.
            - **Decorative motifs:** `EmptyState` shows a muted five-color
              mana-pip row by default (`icon={false}` to omit, or a custom
              node to replace it) — `ManaSymbol`/`SetSymbol` were wired up
              functionally everywhere but never used decoratively; this
              covers all ~17 empty states in the app at once. (`cx()` moved to
              `src/lib/cx.ts` so `ui.tsx` could import `ManaSymbol` without a
              circular dependency with `ManaCost.tsx`.)
            - **Landing page:** rewritten to lead with *"A deck is a real
              place a card lives. Cards sleeved into one stop counting as
              available to build with,"* replacing the old copy that led with
              what the app doesn't do. Added a deck-list mockup — sleeved /
              available-elsewhere / missing side by side — built from the
              real `entryState()`/`DeckStateMark` logic rather than a raster
              screenshot, so it can't drift from what those states actually
              look like and reads correctly in both themes for free.
            Verified in the browser: light/dark, desktop/mobile, live on
            production.

- [x] **Two blemishes** · done 2026-09-07
      "1 entries unpriced" was a flat template literal with no plural check,
      unlike every other count on the page — now "1 entry unpriced." The
      orphaned tile was "Unsorted": 5 stat tiles never divide evenly into
      `grid-cols-2`/`sm:grid-cols-4`, so it always wrapped alone. Dropped it —
      the count is already surfaced in the attention banner and the location
      breakdown, so nothing was lost.

- [x] **Flavor-named cards didn't import** · done 2026-09-08

      Reported directly: a deck import was missing a few cards, and a printed
      card ("Loki's Double") turned out to be a different card underneath
      ("Spark Double"). Root cause: Universes Beyond crossovers (Marvel Super
      Heroes Commander, Tales of Middle-earth, Fallout, Final Fantasy, Avatar,
      the Godzilla alt-arts in Ikoria, ~350 Secret Lair drops — 661 printings
      across 10+ sets) print an in-universe alternate name over the real card.
      Scryfall carries both via `flavor_name`; neither our schema nor the sync
      job stored it, so an import naming the printed name matched nothing and
      was silently dropped as "no card with that name."

      Fixed: migration 26 adds `cards.flavor_name` and extends both the import
      resolver (`src/lib/import/resolve.ts`) and manual add-a-card search
      (`search_card_names`) to match it. Forced a sync to backfill the
      117,628-row table (`workflow_dispatch` on `scryfall-sync.yml`) — the next
      scheduled run would have picked it up regardless. Verified live:
      searching "Loki's Double" now surfaces "Spark Double" correctly.

      **Follow-up, done 2026-09-08:** the display half. Added `cardDisplayName()`
      (`flavor_name || name`) and threaded `flavor_name` through every card
      select this touches — `collection_entries` view (migration 27, appended
      per `CREATE OR REPLACE VIEW`'s column-order rule), both apps'
      `CARD_FIELDS`/`CARD_COLUMNS`, `WANT_CARD_FIELDS`, the dashboard's ad-hoc
      queries, the printings API — and applied it at every render site:
      collection table, card panel, deck workspace, trades, want list,
      dashboard, find page. `search_card_names` (migration 28) now returns a
      sample flavor name too, so every autocomplete dropdown shows it.
      `LocatedCard`/`WantRow` each carry both `name` (real, for `/collection?q=`
      links, which don't index `flavor_name`) and `displayName` (printed) so
      the two never get conflated. Deliberately left the CSV/decklist export
      on the real name — the plain-text format targets Moxfield/Archidekt,
      which are not known to recognize a flavor name.
      Verified live end-to-end: added "Loki's Double" for real, confirmed it
      renders correctly in the add-a-card suggestion, the printing picker, the
      collection table, and the dashboard's "recently added," then removed it.

**Stretch, only if the reset goes fast:** the connected deck row (below). A
half-built version is worse than narrating it — don't start it on day six.

---

## The playgroup demo — worked out 2026-09-04, not yet done

**Nobody but Anthony has ever seen the app.** This is the cheapest, highest-value
action available and it costs nothing.

**What to show:** step 1 of the cascade, on your own collection, with no new code.
Open a real deck. Show a card that is sleeved, one sitting free in a binder, one
you do not own. That is "locked and loaded" made visible and it is the part they
cannot get anywhere else.

**What to narrate but NOT demo:** steps 2 and 3. The cascade is not wired yet — a
missing deck row does not name a friend who has it or offer a buy link. So say the
sentence out loud — *"eventually this row would tell me Dave has one in his trade
binder"* — and watch whether anyone leans in. That is the cheapest possible test of
the cascade hypothesis and it costs nothing to run. If they light up, build the
connected deck row. If they shrug, that is worth knowing.

**What not to show:** the deck charts, the trades UI with no data behind it, or
anything needing "this will eventually…". One complete idea beats four partial ones.

**The ask — do not ask "would you use this".** Friends say yes and mean nothing by
it. Instead: **ask them to export their trade binder from ManaBox and import it
while you are sitting there.** One binder, not their whole collection — a few
hundred cards, lands correctly in one location, and it is exactly what step 2 of
the cascade needs. Whether they actually do it is the first real signal. If the
import breaks on someone's real ManaBox file, that is the most valuable bug of the
month.

**The test that actually matters** is two weeks later, unprompted: *did anyone open
it again, and did anyone file a card after a trade?* The existential question is not
whether the concept is good — it is whether people maintain the data. If they do
not, everything derived becomes confidently wrong, which is worse than absent.
Better to learn that from four friends than four hundred users.

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

- [x] **"Check this list" scratch mode** · done 2026-09-08 · *the front door*
      Paste a list at `/decks/check` (linked from the Decks page) and see it
      reconciled against the collection without creating a deck. "Save as deck"
      is there if you decide to build it, and writes the decklist only — no
      cards move. As predicted, the pipeline was already there: parsing,
      printing resolution and availability are the same code the importer and
      the deck page use, and what was new was running them and stopping.

      **The part that needed new logic.** `deck-state.ts` has three states, and
      its `missing` folds together "you own it, it is sleeved into your Atarka
      deck" and "you do not own it". That is right for a deck you are building
      — neither can be sleeved into this one without a decision — and wrong for
      a list you are deciding whether to build, where one is a walk to a shelf
      and the other is a purchase or a trade. So `src/lib/collection/list-check.ts`
      is its own tested module: ready / in another deck / not owned, with free
      copies spent before deck copies before the shortfall.

      **The trap it was written around.** A decklist may legitimately name two
      arts of the same land — 14 of one Forest, 6 of another. Counted per
      printing, both entries compare against the same "20 free" and both report
      ready, counting the collection twice. The check folds by card
      (`oracle_id`) before counting; the deck, when saved, still keeps the
      printings apart. Verified live: a list asking for 6+4 Forest across two
      printings reported one entry, "6 free · 4 in another deck".

      **Found and fixed along the way:** the deck page header said "N you do not
      own", reading `deckProgress.missingEntries` — which counts entries with no
      *spare* copies, so it included cards sitting in your own other decks. On a
      13-entry test list it claimed 8 when only 3 were genuinely not owned. Now
      "N not available", matching what `DECK_STATE_LABELS.missing` has always
      said. Worth catching before the demo: the pitch is "one sleeved, one free,
      one I do not own", and a header that miscounts the third invites exactly
      the correction that makes the rest of the page look untrustworthy.

      **Still open — the "who has the missing ones" half.** Not built, and the
      shared resolver this tier's preamble asks for is therefore still not
      built either: this pass is own-collection only, the same scope as
      `locateInCollection`. It needs friends with real data, which is what
      Saturday is for. The natural small follow-up before then is bulk-adding
      the missing cards to the wish list — the wish list page cannot yet take a
      prefilled card, which is why there is no link to it from a missing row.

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
