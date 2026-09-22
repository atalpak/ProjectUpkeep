# Project Upkeep backlog and roadmap — the source of truth

**This file is the one list of what to do next, for web and mobile.** If an item is
not here, it is not planned. When work starts, finishes or is re-ranked, update this
file in the same change. Do not keep a second roadmap in a chat, a brief or another
doc (`MOBILE_UI_REFINEMENT_BRIEF.md` is a work brief, not a roadmap; its items are
tracked below). It lives under `apps/mobile/docs/` for historical reasons and covers
the whole product.

Status key: **Doing** (in progress) · **Ready** (scoped, can start) · **Needs
architect** (structural; architect impact map, then owner sign-off, then implementer)
· **Later** (deliberately parked).

## Prioritised roadmap (ranked by ease and impact, re-ranked 2026-09-21)

| # | Item | Ease | Impact | Status | Where |
|---|---|---|---|---|---|
| 1 | Fix the daily Scryfall sync (mobile catalog export step times out) | Easy | High | Doing | `scripts/export-catalog.ts` |
| 2 | Sub-menus / popovers render outside the window | Easy | High | Built, needs owner check (web signed-in pages and phone unverified) | web + mobile, find every menu |
| 3 | Photos in every printing selector | Easy–Med | Med–High | Built, needs owner check (web signed-in pages and phone unverified) | web + mobile |
| 4 | Flip button on double-faced cards (swap image and name, revert on leaving the page) | Easy–Med | Med | Built, needs owner check (web signed-in pages and phone unverified) | web + mobile |
| 5 | Change the printing of a card in the scan session list (unsaved, so low risk) | Med | High | Done (2026-09-22) | `ScanSessionSummary.tsx` |
| 6 | Change the printing of a card you own in the collection | Med–Hard | High | Done (2026-09-22) | `apply_stack_reprint` + `CollectionTable` row menu + `CardDetails.tsx` |
| 7 | Import all Scryfall data, including oracle tags (otags) | Hard | Med–High | Needs architect | sync + schema + search |
| 8 | Other card languages (Japanese, Phyrexian): own, show and scan them (not Japanese-name lookup) | Med | Med | Ready for owner sign-off (architect done) | display pass, trade snapshot migration, scan-core footer fallback |
| 9 | Public leaderboard: all dev items and bugs, up and down votes, doubles as the backlog | Hard | Low until there are users | Needs architect | new tables, web + mobile |

Notes behind the ranking:

- **1** is failing on the schedule now (runs of 2026-09-20 and 2026-09-21). The failing
  step is the catalog export, not the Scryfall import: "canceling statement due to
  statement timeout" at offset 58000, paging by offset. Until fixed, the mobile catalog
  and the in-app "new cards" check do not update, and `latest.json` never publishes.
- **5 before 6:** the session list is unsaved data, so it needs no database change.
  It also mitigates the wrong-printing scan problem while 6 is designed.
  **Done (2026-09-22):** `EditSheet` in `ScanSessionSummary.tsx` gained a "Change
  printing…" step, its own `PrintingChangeSheet` (search by set code / collector
  number, seeded on the row's own card name, narrowed to genuinely the same card
  with `isSameCard`) and `reconcileFinish` (both from `@upkeep/domain`, already
  shipped for item 6's web half) to force a finish pick rather than silently keep
  one the new printing was never made in. `changeStagedPrinting` in
  `ScanScreen.tsx` swaps `printing`/`card_id`/`finish` and re-runs
  `validateDraft`, the same as every other staged-row edit — nothing is written
  to the database; the row stays local until "Add to collection". No migration,
  no new package logic (both helpers already existed for the web reprint
  feature).
- **6** changes a stack's key (the printing), so it must merge safely into an existing
  stack, like `apply_stack_move`. Nothing may write around `apply_stack_addition` /
  `apply_stack_move` for a stacked write.
- **7** has two parts: extra fields already in Scryfall's `default_cards` export, and
  otags. Correction (architect, 2026-09-21): otags ARE now an official Scryfall bulk
  file (`oracle_tags` in `api.scryfall.com/bulk-data`, ~5.7 MB gzipped, updated daily,
  no rate limit, covers 99.4% of our cards), so this is Moderate, not Hard. Plan:
  two tables keyed on the tag UUID (slugs are not stable), a separate
  `scripts/sync-oracle-tags.ts`, migration 39+. The bigger cost is a fast tag search
  (needs a derived array or a SQL function, in both search models). Do it after item 1
  has one green scheduled run. Do not paywall Scryfall data (their terms).
- **8** (architect, 2026-09-21): recommended path is cheap. All 49 Phyrexian printings
  are ALREADY in `cards`, and set + collector number are identical across languages, so
  (1) a display pass showing a copy's language everywhere (collection column on by
  default, trade builder, tradable binder, supplier rows, /find), (2) a `language`
  column on the trade snapshot (new migration, like migration 23), (3) a footer-first
  scan fallback (set + number index in `CardIndex`, pure TS in scan-core, no rebuild,
  also helps full-art English scans), (4) keep the footer language token as the scan
  draft's language. Then stop and ask. Do NOT switch to `all_cards` (4.6x rows, ~30 min
  upsert in a 45 min job, over the free Postgres tier, 34 unfiltered query sites) and
  do NOT ship an all-language mobile catalog (210 MB vs an 80 MB cap). Looking cards up
  by their Japanese name is a separate, much larger request. Wish-list matching stays
  language-agnostic; show the language instead of filtering on it.
- **9** duplicates and extends the in-app feedback button
  (`src/app/(app)/feedback-actions.ts`). With one user, votes carry no signal yet;
  the cheapest way to find out whether it is wanted is to ask real users.

### Owner decisions (2026-09-21: "go with all recommendations")

- **6 (change printing of an owned copy):** web collection list + mobile card details
  sheet only (no mobile per-copy editor yet); a finish the new printing lacks warns
  and forces a finish choice (never hide printings); the deck list line does NOT
  follow; blocked while the copy is in an open trade; one card at a time, no bulk;
  same-card rule stays strict. New `apply_stack_reprint` (migration **39** — checked,
  the directory tops out at 38), ordering test that would inflate a deck list if the
  steps were reordered.

  Architect impact map, 2026-09-21, and the owner decision that came out of it:

  - **Hosting (owner, 2026-09-21): its own row-menu item "Change printing…", NOT a
    field in the Edit form.** The edit form submits condition, finish, language,
    location, quantity and notes as one intent; adding printing makes one Save able
    to change printing *and* quantity *and* location together, and "quantity" means
    *set the stack to N* there while it means *move N copies* in every atomic stack
    function. That combination is the migration-20 deck-inflation hazard. One action,
    one intent instead. Mirrors `DeckWorkspace.tsx`, and gives the finish warning a
    home inside the picker flow.
  - **The sleeved question is answered: by `oracle_id`, not by printing.** Confirmed
    in `availability.ts` (`cardKey`), `queries.ts` (`getDeckList`, `strandedInDeck`)
    and migration 20's trigger. A reprint therefore cannot un-sleeve a card and moves
    no sleeved/available/missing number. This shrinks the feature.
  - **Why the trade block matters more than it looks:** `accept_trade` transfers
    `card_id` as read at accept time, not from migration 23's snapshot. Without the
    block, an in-place reprint silently changes what the counterparty receives while
    the trade UI keeps showing what was offered. Put this in the migration header so
    nobody later relaxes the gate as over-caution.
  - **No `ownership_history` row.** It has no insert policy (inserts come only from
    `accept_trade`), so writing one would force `SECURITY DEFINER` and break hard
    constraint 5; its select policy would also leak every reprint to friends. The
    audit already exists for free in `collection_write_ops` with
    `kind = 'stack_reprint'`.
  - **Order is load-bearing:** clear the source stack *before* incrementing the
    destination, or migration 37's trigger sees an inflated physical total and
    permanently raises `deck_cards`. With no merge target, update `card_id` in place
    rather than delete-and-reinsert, so the row id, `acquired_at` and the
    `trade_items` FK survive.
  - **Say the price may change** in the confirm step. Reprinting a Beta dual onto a
    Revised one legitimately moves collection value by hundreds; unannounced it reads
    as a broken valuation.
  - **Take `p_quantity` from the start** even though v1 always passes the whole row:
    "I swapped one of my four Forests" is the obvious next request, and retrofitting
    means a second migration and a mobile signature break.
  - **Blocked on the current branch landing** — `PrintingPicker.tsx` is still
    untracked on `fix/catalog-export-keyset-paging`, and this feature reuses it as-is.
  - Ships in three parts: migration 39 + schema test; server action + web UI; mobile
    parity last. Migrations land before the code that reads them.
  - **Part 1 done (2026-09-21):** `00000000000039_atomic_stack_reprint.sql` and section
    19 of `supabase/tests/schema_test.sql`. The function refuses a different card, an
    impossible finish, a self-merge, more copies than the stack holds, and any copy in
    an open trade; it replays on a repeated operation id and refuses a reused id with
    different details. Both ordering cases were **confirmed red** with the destination
    incremented first (the whole-stack case inflated a 6-card list to 10, the partial
    case to 7) before being allowed to pass — a green run on a test never seen red is
    not evidence.
  - **Part 2 done (2026-09-22):** `packages/upkeep-domain/src/reprint.ts`
    (`decideReprint`, `reconcileFinish`, `isSameCard`) and `scripts/reprint.test.ts`;
    `reprintCardInstance` in `src/app/(app)/collection/actions.ts`; the "Change
    printing…" row menu item and `RowReprint` panel in `CollectionTable.tsx`, built
    on the existing `PrintingPicker.tsx`. `/api/cards/printings` now also returns
    `oracle_id` (the same-card gate) and the three price columns (the "estimated
    value changes from X to Y" line). Verified against the live dev database: a
    9-card Foundations Mountain stack reprinted in place to Secret Lair Drop #1481
    (value line and result both correct) and back, id preserved, no accidental
    merge.
  - **Part 3 done (2026-09-22):** `packages/scan-core/src/reprint.ts`
    (`createReprintWriter`, the retry-once-on-stale-destination /
    retry-once-on-stale-source wrapper around `apply_stack_reprint`, mirroring
    `move.ts`'s asymmetric shape) with its own tests appended to
    `packages/scan-core/test/core.test.ts`; `reprintStore`/`reprintWriter` in
    `apps/mobile/src/backend.ts`; `OwnedStack` in `apps/mobile/src/cardDetails.ts`
    extended with `cardId`, `language`, `locationId`, `locationType` and `notes`
    (the full stack key `decideReprint` needs, plus the sleeved-in-a-deck flag);
    and a "Change printing…" action per owned-stack row in
    `apps/mobile/src/components/CardDetails.tsx` (`OwnedStackRow` /
    `ReprintPanel`) — the finish-reconciliation picker, the "estimated value
    changes from X to Y" line and the sleeved-deck note all mirror the web
    `RowReprint` panel, built on the sheet's own already-loaded printings list
    rather than a second fetch. Item 6 is now fully shipped, web and mobile.
- **7 (Scryfall data and otags):** official `oracle_tags` bulk file, two tables keyed
  on tag UUID, separate `sync-oracle-tags.ts`; card fields = full_art, border_color,
  promo, promo_types, frame_effects, frame, textless, variation, edhrec_rank,
  reserved, illustration_id, games (legalities deferred until the deck legality check);
  first feature = collection filter. **Rule: paid tiers may gate the user's own
  collection features, never Scryfall card data (Scryfall's terms).** Order: item 1
  green run, then tags and card fields, then scanner fields, then search.
- **8 (languages):** own, show and scan foreign cards; not Japanese-name lookup.
  Phyrexian as-is is enough. Steps: display pass, `language` on the trade snapshot,
  footer-first scan fallback, footer language token. Wish lists stay language-blind
  but show the language. Live `cards` size checked 2026-09-21: **118,612 rows**, which
  confirms the cheap path — the display pass adds no rows, and `all_cards` would mean
  roughly 546,000.
  - **Step 1 done (2026-09-22):** the display pass. Web: the collection table's
    `language` column now defaults on (`src/components/collection/columns.ts`,
    `scripts/collection-columns.test.ts` updated to match); a badge, shown only
    when a copy is not English (the same "only when it deviates" rule `FoilMark`
    already uses for finish), was added to the trade builder's offer rows
    (`src/components/social/TradeBuilder.tsx`), the tradable-binder views
    (`src/components/social/TradableBinderPreview.tsx`, `ProfileTradables.tsx`),
    the deck page's own wish-list supplier lines (`DeckWorkspace.tsx`), and
    `/find`'s own-collection place rows and "Among your friends" rows
    (`src/app/(app)/find/page.tsx`). Supplier rows across `/wants`, a deck's wish
    list and the card-popup "friends have this" line all share `WantSupplier`
    (`src/lib/social/wants.ts`), which now carries a deduped `languages: string[]`
    alongside `locations`, filled in `matchWants` / `matchTradablesByTerm` from a
    new `language` field on `TradableRow`; `describeSupplier` gained an optional
    third parameter that appends `(Japanese)` and the like, defaulting to `[]` so
    every existing call site reads exactly as before until it opts in — all of
    them now do except `/decks/check`'s own separate `CheckSupplier` type, which
    this step left alone. `getFriendTradables` / `getMyTradablesForMatching`
    (`src/lib/social/queries.ts`) now select `language`; `/find`'s own-collection
    half needed the same in `locate.ts` (`Place.languages`, fed by a new
    `LocatableRow.language`) and `locateInCollection`. Mobile: the collection
    list already showed language when non-English (`CollectionScreen.tsx`,
    pre-existing); added to the trade builder's offer rows
    (`TradeBuilderScreen.tsx`) and a friend's profile — both trade-binder and
    wish-list rows share one row renderer (`FriendProfileScreen.tsx`) — via a new
    `language` field on `FriendCard` (`friends.ts`, `trades.ts`) and
    `@upkeep/domain`'s existing `LANGUAGE_LABELS`. No mobile /find screen exists
    yet (placeholder), and mobile has no wish-list supplier matching yet, so
    neither needed a change. Tests added: `scripts/wants.test.ts` (supplier
    language aggregation and `describeSupplier`'s new parameter),
    `scripts/locate.test.ts` (place language aggregation). Steps 2–4 (the trade
    snapshot's own `language` column, the footer-first scan fallback, the footer
    language token) are not started.
- **9 (leaderboard):** test demand first (one line in the feedback box, then a public
  page or GitHub Discussions). Build the feedback admin inbox (`is_admin()`, never
  built) first. If built later: signed-in only, owner-created items only, advisory
  votes, this file stays the authority.

### From the mobile UI refinement brief (`MOBILE_UI_REFINEMENT_BRIEF.md`)

Ready, not yet ranked against the table above: unified Mort-centred header (fixed
44pt left/right regions, back chevron on detail screens, native detail headers off);
simplified Settings; collection filters in a bottom sheet; consolidated spacing,
type and components; fewer bordered containers; menu organisation; loading and
interaction polish.

### Found while mapping item 6 (2026-09-21) — not yet ranked

- **Editing a copy into an existing stack creates a duplicate row today.**
  `updateCardInstance` (`src/app/(app)/collection/actions.ts`) is a plain update with
  no stacking merge, unlike `addCardInstance` twenty lines above it, which routes
  through `decideStacking` / `apply_stack_addition`. So changing a copy's condition,
  finish, language or location to match a stack you already own leaves two identical
  lines on the collection page. Live now, independent of item 6 — but it becomes
  glaring the moment reprint *does* merge, since the two paths will visibly disagree.
- **Migration 20's shortfall placement is only tested at tier 1.** The oldest-entry
  fallback and the fresh-row tier have no regression test, and the oldest-entry
  fallback is nondeterministic inside one transaction (`now()` is frozen, so
  `created_at` ties). A reprint is a new way to steer the trigger into tiers 2 and 3.

### Housekeeping

- Commit the support address change in `src/lib/support.ts`
  (`projectupkeepapp@gmail.com`, replacing the `example.com` placeholder).

The sections below are the detailed lists behind these items; they are grouped by
area, not by priority.

## Pages that are still placeholders

Only **Find** ("where is my card?") is left; it is deliberately out of the menu
for now. Everything else in `BUILT` (`src/navigation.ts`) has a real screen.

Built since this list was first written, with what each still lacks:

- **Dashboard** — value, totals, needs-attention (including trades waiting on you), deck status, recently added. Missing: the "expiring offers" line.
- **Trades** — proposals in both directions, build and counter-offer, accept, or close.
- **Notifications** — friend requests, trade activity.
- **Import** — paste a list or a CSV into the **collection** only. Missing: importing into a deck, and picking a file rather than pasting.

## Decks

- Edit deck details: format, tags, notes.
- Share-with-friends switch (the Private / Shared pill is read-only today).
- Deck statistics and charts.
- Playtest.
- Export the list.
- The deck's own wish list, and "add to wish list" from a missing card.
- Add a card to a deck's list from the card details sheet (excluded from the
  first pass as quick-add).
- Rename and delete a deck.

## Cards and collection

- Move / edit a copy you own from the card details sheet (excluded from the
  first pass).
- Quick-add: "add another", and adding straight to a deck.
- Wish list: change the wanted quantity, not just add and remove.
- Collection: sort options (name, mana value, rarity, price).
- Card details: prices in the list rows (display-only Scryfall estimate).
- Two-sided cards: a flip button now exists on the tiles and rows listed under roadmap item 4, and on the Add-a-card preview (added 2026-09-21 — it had been missed, and it is the screen where seeing the back actually decides which printing you own). Still without one: the collection table rows, the small list-row thumbnails on the web and the deck detail list (no card picture there).

## Scanner

- Alternate-art accuracy: **quick scan** now reads the footer properly, opens on a
  footer-based best-guess printing at once and compares the card's picture with each
  candidate's in the background, switching only when confident (plan steps 2 and 4;
  the 2026-09-19 owner decision dropped the "Which printing is this?" picker; unverified on a device). Still open: the main Scan tab does not use the picture
  step; a sharper still-photo capture for the footer (step 3); printing-type flags
  in the catalog (step 5, needs a migration); the 20-30 real-card test set (step 6),
  which is what turns the accuracy script's sample numbers into evidence.
- Quick scan capture feel (2026-09-19 owner feedback, all unverified on a device): built
  for a card held in the HAND. No outline while searching; once a card has been a
  valid full card for 3 detections and is not being swept through (`BurstTracker`,
  0.05 loose movement), every frame is straightened and the first with sharpness >= 40
  is read, else the sharpest at 0.7s (if >= 20) or at 1.2s regardless; green outline
  held 0.35s; box 320x440; a live coaching line at the TOP of the box (`onScanStatus`,
  old builds keep the static hint). Tune from real use: `BurstTracker` constants,
  `minimumSharpness`, the area floor (0.18), `STATUS_MIN_MS` (400). The frame is
  detected whole, so a card can lock while partly outside the visible (cropped) box.
- Quick scan "Couldn't read that clearly" every time (2026-09-19 owner feedback, all
  unverified on a device): focus/exposure/zoom are re-applied after each preset change
  (they were probably being lost to the preset switch) and follow the tracked card;
  zoom is OFF (`quickZoomCap` 1.0) and the session is back to 1080p (the 4K + 2x zoom
  experiment was backed out after phone testing); frames are skipped while the lens hunts (<= 0.6s);
  blurry 1.2s fallbacks are retried (<= 2); a rejected read is retried on the held
  card (`retryToken`, 0.4s); the retries are silent and after 4 the line advises more
  light / less glare (the person is never told what was read). The title is now read
  from the top 23% of the card only. To
  confirm on a phone: whether the focus point orientation is right (a wrong mapping
  focuses on the wrong part of the frame, so watch for it on a card held off-centre),
  whether `focusPointOfInterest` is relative to the zoomed or the full field of view,
  the zoom the device picks, and the constants above. Read the `[quick-scan] rejected`
  log in Metro to tell OCR from matching.
- Wrong printing on quick scan (Bloodline Bidding ECL #91 opened ECL #385): the
  default is now the regular print (`regularFirst`), the picture switch needs a
  0.75 ratio (0.5 over a footer guess), the footer gets a
  footer-only second OCR pass (on the 1080p card; the "may not be the printing" note was
  removed from quick scan's hand-off). Unverified on a device: whether the footer
  now reads at 1080p, and the ratios. The web wish-list default (`wants/actions.ts`)
  has the same set-type-only tie and was left alone.
- Quick scan (hold Scan, slide to the Scan option): tune the "how sure" cutoff
  (`QUICK_MIN_SCORE` in `packages/scan-core/src/band.ts`) against real cards, and
  check the lock-on speed in poor light.
- Accuracy benchmark (offline, no phone): `npm run accuracy -w @upkeep/scan-core`
  runs the shipped matching over labelled OCR reads and sweeps `QUICK_MIN_SCORE` /
  `QUICK_AMBIGUITY_MARGIN`, reporting exact / right-card-wrong-printing / wrong card /
  abstained. Real use: `-- --catalog catalog.json --reads reads.json` (a missing catalog
  skips cleanly). The bundled sample in `scripts/fixtures/` is illustrative only; the
  cutoff stays untuned until reads are captured from a device.
- Haptics on the fan-out button (needs a native package, so a rebuild).
- Android live scanner (iOS only today).

## Card database

- `latest.json` has never been published: it appears after the next publish that
  follows the update-check change (next daily run that finds a change, or run the
  Scryfall sync workflow by hand with force). Until then the app's update check
  quietly finds nothing. Test the "New cards are available" window once it does.
- Run `npm run catalog:snapshot` before every native build, or the app ships
  without the bundled database and asks users to download it.
- If the full 40 MB update proves too heavy: a "just the changes" update.
- Measure the launch-time cost of parsing the catalog on a real phone.

## Native rebuilds waiting on the phone

- `expo-sensors` (foil tilt) was added after the last phone build. The tilt only
  works once the phone is rebuilt; until then the foil shows and responds to a
  finger drag.

## Scanner tuning on the phone

- If the phone runs hot in quick scan, straighten and score only every Nth
  sample frame instead of every one.

## App shell and polish

- Settings: change password and notification preferences (delete account is built).
- Search: filter results by what you own, and a "recent searches" list.
- Dark mode: audit every screen for contrast on real hardware.
- Automated tests over the screens (none exist; only the shared logic in
  `packages/*` is tested).
- Web app: fold its own copies of the search, collection-filter and deck-grouping
  rules onto `packages/upkeep-domain`, which the mobile app already uses.
