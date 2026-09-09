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

## UX & design review — done 2026-09-08, three fixed, rest logged

A page-by-page walk through the signed-in app. The three most critical were
fixed the same day (see below); everything under "Still open" is real but can
wait for the demo to reorder it.

**The finding that framed the rest:** card art is distributed almost exactly
opposite to how much each page matters. The dashboard gives six full-size
images to "recently added" — the least decision-relevant thing in the app —
while the decks list, the locations list and the collection table have none at
all, and the collection's 18 optional columns do not include a thumbnail.

- [x] **Deck rows show the deck** · done 2026-09-08
      The row was a line of text whose loudest element was a red-bordered
      Delete — the destructive action styled above the deck itself — and it
      printed "100 cards (72 unique)", which every other collection tool can
      also print. Now a card: the commander's art as its face, colour-identity
      pips, and a bar reading "62 of 100 sleeved" or "Ready to play". That last
      number is the one only this app can print, and it was the one the row left
      out. Delete moved behind a quiet ⋯.
      `getDecks` grew the commander's image and colour identity (the commander
      lookup already existed — two more columns) plus a sleeved count, taken
      from `collection_entries` scoped to deck locations and capped per entry
      the same way `deckProgress` caps it, so the row and the deck page cannot
      disagree. The face shows the **whole card**, not an art crop: any fixed
      crop lands on the type line of a planeswalker, a saga or a full-art land,
      and roughly a third of commanders are one of those.

- [x] **"Available" says why it is zero** · done 2026-09-08
      The column that carries the entire premise of the product rendered as a
      bare `0`, with the reason — the copy is sleeved into a deck — reachable
      only by hovering, or by turning on the Location column, which is off by
      default. A zero that does not say why reads as "you have none", the
      opposite of the truth: you own it, it is busy. A committed copy now names
      its deck ("In Atarka, Baby") instead of counting to zero. The mobile row
      says "Sleeved", since it already prints the location beside it.

- [x] **Touch targets** · done 2026-09-08
      Measured at 375px: 120 interactive elements under the 44px both Apple and
      Google call reliably tappable. The worst were the row checkboxes at 16×16
      — multi-select is how a stack gets moved after a trade — and the pager at
      26×32, the smallest controls in the app.
      Fixed through `Button`/`Input` and the pager, the row ⋯ menu, the header
      icon buttons and the trade/want steppers, all via the existing `coarse:`
      variant rather than a width breakpoint. That was already the documented
      house rule (`globals.css`: a narrow laptop window still has a mouse, a
      wide tablet does not) and the first attempt here got it wrong with `sm:`.
      Desktop is deliberately unchanged — Apply stays 36px, the pager 26×32.
      Checkboxes keep their 20px box inside a 44px padded label, so the target
      grows without a chunky box being drawn.

- [x] **"Not in a deck" toggle on the collection page** · done 2026-09-08
      A one-click pre-filter beside the search box: hide every copy sleeved
      into a deck, leaving what is actually free to build with. On a 699-entry
      collection it drops to 459 entries / 595 cards — exactly the three
      100-card decks removed.
      `location` could not express this (it picks one container; this excludes
      a class of them), so it is a new `availableOnly` flag on the filter,
      pushed into SQL as `location_type.is.null,location_type.neq.deck` — an OR
      rather than a plain `neq` because in SQL a null location fails
      `<> 'deck'` instead of passing it, and unsorted counts as available. It
      is about the *row*, not the card: a playset with three sleeved and one in
      a binder keeps the binder row and drops the deck rows, which is the
      honest answer to "show me what is free".
      Two things worth remembering: `activeFilterCount` stringified every
      non-array value, and `String(false)` is truthy as a string — an unchecked
      toggle would have read as an active filter forever. And the toggle is
      adjusted during render rather than in an effect, so the back button
      cannot leave it lying about what is on screen.

      **Now on by default** (2026-09-08). The URL carries `available=0` for the
      off state rather than `available=1` for on, so a bare /collection means
      the default and a shared link still says what the sender was looking at.
      A default is not licence to hide things quietly, so two things go with it:
      the subtitle says "(filtered from 699)" whenever anything is held back —
      counted from the numbers, not from `isFilterActive`, which deliberately
      ignores a filter left at its default — and an empty result offers
      "Include cards in your decks" first, keeping whatever else is applied.
      Saying "nothing matches" to someone looking for a card they definitely
      own is how a tool loses trust.

**Still open, roughly in order of value:**

- [x] **Badges covered the cards in Images mode** · done 2026-09-08
      The review called this "the name printed twice" and had the mechanism
      wrong: there was no overlay label. What was actually happening is that
      both badges landed on the parts of a Magic card you came to look at — the
      state mark sat on the printed name, so every card read "koum Hellkite",
      "roodcaller Scourge", and the quantity sat on the power/toughness box.
      There is no safe corner: name top-left, mana cost top-right, P/T
      bottom-right, set and artist bottom-left. So in the one view whose
      purpose is showing the cards, nothing is drawn on them — mark, quantity
      and commander star moved into the caption row under each card. Scanning
      still works because an unplayable card is dimmed as well as marked.
- [x] **Locations, and the tradable switch** · done 2026-09-08 — one job, so
      done together: the switch is a property of a container, and containers
      are managed here.
      Each location now carries a type glyph (shapes, not colours, so a binder
      / box / deck still read apart in either theme and for a colourblind
      reader), a fan of its five most valuable cards so a box is recognisable
      as *that* box rather than a number, and a summary line reading
      **N cards · N different · $value**.
      That line first tried to be a progress bar, which was wrong rather than
      merely redundant: a bar implies a capacity and a box does not have one,
      so drawn against the fullest location it said "Commons holds more than
      Lands" — the same thing the numbers beside it said, dressed up as a
      measurement against a limit that does not exist. The three facts that
      replaced it are what you want to know before opening a binder: how much,
      how varied (a brick of one common and a box of singles are different
      objects — Lands is 115 cards but only 29 different), and what it is
      worth, which is the first question in any trade.
      Value is computed through `rowValue`, deliberately *not* the view's own
      `display_price` column: the column mirrors what the UI shows and falls
      back from a missing foil price to the non-foil one, while the dashboard's
      total refuses that substitution. Using the column would have made
      locations quietly sum to more than the dashboard's collection value.
      Verified: the seven locations sum to $448.09, the dashboard's figure, to
      the cent.
      **"Entries" is now "stacks" across the interface** (2026-09-08), prompted
      by a fair question: a Commons tile saying "138 different" next to a
      collection page saying "142 entries" looks like one of them is wrong.
      Neither is — 138 is card names, 142 is rows, and four of those cards are
      held in both foil and non-foil, which cannot share a row. But "entries"
      is a word about a table nobody asked to think about, and it gave no
      reason to expect the two to differ. "Stack" is the app's own word for the
      physical thing (see `stacking.ts`), it explains itself, and nobody expects
      "different cards" and "stacks" to be equal. The tile now names its unit
      too — "138 different cards" — and its title spells the reconciliation out.
      Nested rows can show a card count for the first time — `LocationNode.children`
      is a plain `Location[]` with no count attached, so `getLocationTree` now
      hands back the map it was already building. All of it comes from one
      bounded pass over `collection_entries`.
      **The switch** now sits on every non-deck row, and while nothing at all is
      open there is a banner at the top of the page saying so in plain terms.
      Marking a container tradable is the only thing that makes any card
      visible to another person, and it lived five sections down the Friends
      page; the usual outcome was a collection nobody could see and a trading
      half that silently did nothing. It is still on Friends too — both read
      and write the same column, verified.
      Also: the create form is behind a "New location" button rather than
      sitting open above the list, so the page opens on the shelf it describes
      instead of on data entry; and Delete moved into a ⋯ menu.

      **Grouped by kind** (2026-09-08): Binders, Boxes, Decks, Other, each with
      its own count of locations and cards, empty kinds omitted. Sections
      collapse and the choice is remembered per browser — worth having mainly
      for Decks, which now have a far richer page of their own, so someone here
      to manage boxes can fold them away. Default open: collapsing is a
      decision someone makes, not a state to arrive in. Stored through
      `useSyncExternalStore` for the reason `columns.ts` documents — reading
      localStorage during the first render disagrees with the server HTML, and
      reading it in an effect is what React now warns about.

      **"Container" is gone from the wording** — it was jargon for a thing the
      page already calls a location, including in the nesting error message.
      Still said on the Friends page, the trade builder and the terms page;
      those are a separate pass.
      `Location.is_tradable` is now on the type rather than cast at each call
      site (`not null default false` since migration 9).
- [ ] **Optional thumbnail column in the collection table** · small
      Eighteen columns, none of them an image. The card panel covers hovering,
      but a thumbnail column would make scanning a shelf feel like cards.
- [x] ~~**Live search**~~ — withdrawn 2026-09-08, the review was wrong. The name
      box already filters as you type (debounced 300ms, and it `replace`s so a
      search is one history entry rather than one per keystroke). Apply belongs
      to the advanced panel only.
- [ ] **Pager only at the bottom** · trivial
      On a 50-row page, changing page means scrolling the whole page first.
- [ ] **Friends page does too much; Wish List and Add a card do too little**
      Friends stacks trades, activity, terms, search, friend list and container
      privacy on one page. Wish List is one input and an empty state; Add a
      card is one input on an otherwise blank page. Fold into the IA item below
      rather than fixing piecemeal.
- [ ] **Dashboard: "By colour" is visually orphaned** · trivial
      A bare row of pips floating in a half-empty column beside "By set", which
      is a full card with bars. Same kind of information, wildly different
      weight. Fold into the dashboard reframe below.
- [ ] **"Recently added" repeats a card** · trivial
      Two entries of the same card show as two identical tiles. Dedupe by card
      and show a count.

---

## Tier 3 — conditional, after real usage

- [ ] **Dashboard reframe** — currently leads with inventory stats (value, count,
      unsorted). The product's question is "what can I build, who has what I
      want." Wait until the demo so their reaction shapes it. The 2026-09-08
      review adds: six full-size card images are spent on "recently added",
      nothing on the page links to "Check a list", and none of the four tiles
      is actionable.
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
