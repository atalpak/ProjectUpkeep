# Project Upkeep backlog and roadmap — the source of truth

**This file is the one list of what to do next, for web and mobile.** If an item is
not here, it is not planned. When work starts, finishes or is re-ranked, update this
file in the same change. Do not keep a second roadmap in a chat, a brief or another
doc (`MOBILE_UI_REFINEMENT_BRIEF.md` is a work brief, not a roadmap; its items are
tracked below). It lives under `apps/mobile/docs/` for historical reasons and covers
the whole product.

Status key: **Doing** (in progress) · **Ready** (scoped, can start) · **Needs
architect** (structural; architect impact map, then owner sign-off, then implementer)
· **Owner only** (nothing for an agent to build — needs the owner's own hands, eyes or
a phone) · **Blocked** (waiting on another item) · **Later** (deliberately parked).

**Context for every ranking below: this is a solo-developer app with one real user,
the owner, and no other users yet.** Nothing here is ranked on usage data, because
none exists — only on data safety, what blocks what, and the owner's own experience.
Say so again wherever it would otherwise read like invented demand.

## Prioritised roadmap (full re-rank, 2026-09-22, by `assessor`)

| # | Item | Ease | Impact | Status | Where |
|---|---|---|---|---|---|
| 1 | Daily sync: the database write is failing, not just the export step | Med | High | Open — one green run (2026-09-22 manual), cause still undiagnosed | `scripts/sync-scryfall.ts`, migration 33 |
| 2 | ~~Collection actions still create duplicate rows outside `bulkMerge`~~ | — | — | **Done (2026-09-23)** — migration 41 (`apply_stack_rekey`) + every web call site rewired onto it | `collection/actions.ts`, `bulk-actions.ts`, `decks/actions.ts` |
| 3 | ~~Migration 40 not applied in production~~ | — | — | **Done (2026-09-22)** — applied, PR #78 adds a CI check so it can't recur silently | — |
| 4 | One real session on a physical iPhone | Owner only | High | Blocks ~10 other items | scanner, item 8 steps 3–4, dark mode |
| 5 | Items 2–4 (old numbering): web sub-menus, printing photos, flip button | Easy | Medium | Owner only — built in PR #69, needs a look | web pages |
| 6 | ~~Phone: move a copy to another binder/box from the card details sheet~~ | — | — | **Done (2026-09-23)** — unverified on a device, see item 4 | `CardDetails.tsx`, `apply_stack_move` |
| 7 | ~~Migration 20: test the deck-list shortfall's 2nd and 3rd tiers~~ | — | — | **Done (2026-09-23)** — `schema_test.sql` section 22 | `schema_test.sql` |
| 8 | Rest of the scanner alternate-art plan | Med | Med–High | Mostly blocked on #4 | `SCANNER_ALTERNATE_ART_PLAN.md` |
| 9 | Import all Scryfall data, including oracle tags (otags) | Med–Hard | Med–High | Blocked on #1 | sync + schema + search |
| 10 | Mobile UI refinement brief (7 items) | Varies | Medium | Priorities 1, 2, 3 and 6 done (2026-09-23) — unified header, Settings nav-slot editor, menu grouping and the collection filter bottom sheet all merged; 4, 5 and 7 still open | `apps/mobile/src/components/AppHeader.tsx`, `SettingsScreen.tsx`, `MenuSheet.tsx`, `CollectionScreen.tsx` + brief |
| 11 | Phone deck gaps: add-to-deck from card sheet, deck wish list, stats, export, playtest | Med each | Low–Med | Open — depends on owner's habits | `apps/mobile/src/screens/DeckDetailScreen.tsx` |
| 12 | Phone quick-add straight to a deck | Easy–Med | Low–Med | Partly done | `ScanScreen.tsx` |
| 13 | ~~Phone collection rows: show prices~~ | — | — | **Done (2026-09-23)** — unverified on a device, see item 4 | `CollectionScreen.tsx` |
| 14 | Phone Settings: change password / notification prefs | Easy–Med | Low | Open | mobile Settings |
| 15 | ~~Phone search: filter by owned, recent searches~~ | — | — | **Done (2026-09-23)** — unverified on a device, see item 4 | mobile search |
| 16 | Phone import: into a deck, pick a file | Med | Low | Open | `ImportScreen.tsx` |
| 17 | ~~Web search should use the shared `packages/upkeep-domain` parser~~ | — | — | **Done (2026-09-23)** | `src/lib/cards/search-query.ts` |
| 18 | ~~Web wish-list default picks the wrong printing on a tie~~ | — | — | **Done (2026-09-23)** | `wants/actions.ts` |
| 19 | ~~Phone dashboard: "expiring offers" line~~ | — | — | **Done (2026-09-23)** — unverified on a device, see item 4 | `dashboard.ts` |
| 20 | Automated tests over mobile screens | Hard | Low for now | Later | — |
| 21 | Haptics on the Scan fan-out button | Easy (needs rebuild) | Low | Later — bundle into next rebuild | — |
| 22 | Android live scanner | Hard | Low | Later — no Android user yet | `packages/upkeep-vision` |
| 23 | Public leaderboard with votes | Hard | Unmeasurable | Later | needs `is_admin()` first |
| 24 | Tactile solo playtester ("Play" mode) | Hard | High (if used) | Phase 1 done (2026-09-23) — deterministic game core landed; Phase 2 (desktop tabletop UI) is next | `src/lib/playtest/board/` (new, not `packages/playtest-core/` — see notes), `src/lib/playtest/game-start.ts` (new), `src/components/playtester/` (not started), new `playtest_sessions` migration in Phase 3 |
| 25 | "Fits this deck" collection-aware recommendations | Med | Medium | Ready — architect impact map + owner decisions done 2026-09-23 | `src/lib/recommendations/deck-fit.ts` (new), migration adding a narrow `cards.commander_legality` column |

Items 5, 6 and 8 (old numbering) are fully shipped as of 2026-09-22 (PRs #71–#76) and
are dropped from this table — see "Owner decisions" below for what future work should
know about them, not what's left to do.

**Items 24 and 25 are appended, not re-ranked.** They arrived as full written proposals
(`PLAYTESTER_IMPLEMENTATION_PLAN.md` and `FITS_THIS_DECK_DEVELOPMENT_GUIDE.md`, both at
the repo root) on 2026-09-23 and are recorded here so this stays the one list, per this
file's own rule — their position in the table is not a claim about priority relative to
items 1–23; only `assessor`'s full re-rank sets that. Both are structural (new table +
RLS for 24, a new `cards` column for 25) and need an architect impact map and owner
sign-off before any implementer work starts, per `.claude/ORGANIZATION.md`'s delegation
rules. Item 24's architect pass was requested 2026-09-23; item 25's has not been.

### Notes behind the ranking

- **1 (sync database write).** The file used to say the export step was the only
  problem; it was fixed (PR #68) and today's manual run proves it (100,237 rows
  exported clean, `latest.json` finally published). But the **import** step —
  `sync:scryfall`'s own upsert — has been failing or nearly failing on its own for over
  a week. Its adaptive batch-halving retry had to shrink the batch size on 9 of the
  last 12 runs, and failed outright (hit the 25-row floor) on 4 of the last 7
  *scheduled* runs:

  | Date | Smallest batch reached |
  |---|---|
  | 09-11 | never shrank |
  | 09-12 | 125 |
  | 09-13 | 125 |
  | 09-14 | 32 |
  | 09-15 | 63 |
  | 09-16 | **failed at 25** |
  | 09-17 | **failed at 25** |
  | 09-19 | 32 |
  | 09-20 | **failed at 25** |
  | 09-21 | 63 |
  | 09-22 (scheduled) | **failed at 25** |
  | 09-22 (manual re-run) | 30, then succeeded |

  A lead, not proven: migration 33 (`card_search_trgm_indexes`, two new indexes on
  `cards.type_line`/`cards.oracle_text`) landed 2026-09-12 — the same day batches
  first needed shrinking. Not confirmed as the cause. Cheapest next step: time one
  small write against the live database, or check when migration 33's indexes were
  actually built there (an index build itself can starve concurrent writes for a
  while, not necessarily forever). Cost of leaving it: prices and new cards stop
  updating, and a newly-released card is missing from the phone's offline catalog
  until a sync succeeds. Also **blocks #9** (otags means more columns per write,
  which makes this worse before it's better).

- **2 (collection actions still create duplicates), done 2026-09-23.** All four bugs
  originally lived in `src/app/(app)/collection/actions.ts`, `bulk-actions.ts` and
  `src/app/(app)/decks/actions.ts`; the safe, already-existing pattern
  (`apply_stack_addition`/`apply_stack_move`, a stacking *decision* in
  `packages/upkeep-domain` then an atomic RPC) was used by none of them, and now all
  of them route through the new `apply_stack_rekey` (migration 41) instead — see the
  "Fixed" entry below for the full shape.

  - **Fixed (2026-09-23, #79): `bulkMerge` no longer inflates deck lists.** It used
    to raise the kept row's `quantity` to the combined total, *then* delete the
    absorbed rows (`bulk-actions.ts:239–252`) — migration 37's trigger reacted to that
    first update, summed every row still physically in the deck (migration 20) while
    the about-to-be-deleted rows were still there, and raised the deck's tracked
    count, which the trigger only ever raises, never lowers. Now deletes first,
    updates second — the same ordering migration 39's header requires for a reprint's
    merge branch. `schema_test.sql` section 20 replicates the exact two-statement
    sequence and was confirmed red with the old order before being allowed to pass.
    **This did not make `bulkMerge` atomic** — it's still two separate client
    requests, not a transaction, so a rare network failure between them can still
    leave things partially done (surfaced as "Merge stopped part-way," already
    handled). It only removes the specific inflation bug.
  - **Unknown, and worth checking before anything else here:** whether the owner's own
    collection already has duplicate rows or an inflated deck list from past use of
    these actions. A read-only query grouping `card_instances` by card/condition/
    finish/language/location and counting groups >1 would answer this cheaply — not
    yet run (needs direct database access this session didn't have).

  **Architect impact map, 2026-09-22, and the owner decisions that came out of it:**

  - **The map found this is bigger than "duplicates."** `unsleeveCopies` and
    `removeEntryFromList` (`decks/actions.ts`, behind unsleeve/remove on the deck
    page) ignore every write error — a partial failure there doesn't duplicate a
    row, it can make copies **vanish silently**, worse than anything else in this
    item. `addToDeck`'s source read and `bulkMerge`'s read both skip the owner
    filter (hard constraint 3) — exploitable only via a hand-crafted request, not
    through the UI, but a real gap. Migration 39's header is already stale: it
    claims trades block a copy from being deleted, but migration 25 quietly changed
    that to `SET NULL`, so a merge/move of a traded copy can already orphan that
    trade with no warning. `removeFromDeck` and `moveCardInstance` are both dead
    code (no callers) — delete both.
  - **Recommended shape: one new function, not four patches.** A single atomic RPC,
    `apply_stack_rekey`, taking an ordered list of steps (each: move N copies to a
    new condition/finish/language/location, optionally merging into an existing
    pile), one transaction, all-or-nothing. Every web path in this item —
    `updateCardInstance`, `bulkMove`, `bulkSetField`, sleeve/unsleeve, remove-from-
    deck, and `bulkMerge` itself — routes through it. A one-row-per-call signature
    was considered and rejected: bulk actions on up to 5,000 rows (`MAX_BULK_IDS`)
    would mean ~10,000 sequential calls otherwise, very likely to time out on
    Vercel. `bulkMerge` folds into this migration too — it closes the same
    lost-copies-on-partial-failure window the unsleeve paths have, and adds the
    missing owner filter.
  - **Owner decisions (2026-09-22):**
    - Edit form changing quantity and other attributes together: set quantity
      first, then re-file the whole pile as two ordered steps — the same
      two-steps-not-one resolution the reprint feature already used for this exact
      ambiguity.
    - Open-trade gate: block a merge/split step the same way `apply_stack_reprint`
      already does. Staying in the same row (no merge/split) is still allowed.
    - Finish check: only refuse an impossible finish when the finish is actually
      changing — the edit form deliberately allows keeping a copy's existing finish
      untouched even if the catalog data looks odd; checking always would break that.
    - Function shape: list-of-steps in one call, not one row per call (see above).
  - **Mobile needs no changes.** It never uses any of these four paths — it writes
    to `card_instances` only through `apply_stack_addition`/`move`/`reprint`
    (`apps/mobile/src/backend.ts`). Two small, separate mobile bugs surfaced in
    passing, logged here rather than acted on: `apply_stack_move` gives a
    whole-pile move a new row id and a fresh `acquired_at` (so it reads as
    "recently added" and loses its trade link) where the web keeps the same row;
    `packages/scan-core/src/move.ts:129` passes `notes: null` into `decideStacking`,
    so a copy with a note can be silently merged (and the note lost) on sleeve.
    Neither is urgent; both could be fixed later by moving mobile onto
    `apply_stack_rekey` too.
  - **Out of scope, flagged for later:** the CSV import (`src/lib/import/commit.ts`)
    has the same absolute-total-overwrite problem sleeve/unsleeve have, but it's an
    *add* path, not a re-file, so a different fix shape. Not folded into this work.

  **Fixed (2026-09-23): `apply_stack_rekey` (migration 41) and every web call site
  rewired onto it.** One new `SECURITY INVOKER` function taking an ordered list of
  steps (`set_quantity`: an absolute set, in place; `rekey`: move N copies to a new
  condition/finish/language/location, merging into a decided target or updating in
  place or splitting), one transaction, all-or-nothing — shape exactly as the
  impact map and owner decisions above specified. `schema_test.sql` section 21
  covers whole-pile merge in a deck, partial merge, the two-printings-in-a-deck
  shortfall-attribution case, the keep-the-row (in-place) branch preserving id/
  `acquired_at`, all-or-nothing rollback on a stale later step in the same call
  (confirmed against a genuine retry afterward, not just the failure), the finish
  check firing only when the finish changes, the open-trade gate blocking merge/
  split but allowing a same-row rekey, and cross-user/self-merge/stale-row/replay
  refusals — confirmed red against a reintroduced increment-before-decrement
  ordering bug before being allowed to pass, the same discipline section 19 used.
  - `updateCardInstance` (`collection/actions.ts`) now reads its source row
    owner-scoped first (it used to trust RLS alone and write blind) and submits a
    `set_quantity` step followed by a `rekey` step only when condition/finish/
    language/location/notes actually changed — the two-steps-not-one shape the
    owner decided on. No longer creates a duplicate row when the new key matches
    a stack already owned.
  - `bulkMove` and `bulkSetField` (`bulk-actions.ts`) now merge into a matching
    stack at the destination (or an identical stack elsewhere in the same
    selection) instead of never merging at all — the missing-merge bug named
    above, fixed in both places at once via a new shared, pure, unit-tested
    decision function (`planBatchRekey`, `src/lib/collection/rekey.ts`) that
    applies `decideStacking` sequentially across an ordered batch.
  - `bulkMerge` folds into the same RPC: its read now filters on `owner_user_id`
    (the gap the impact map found), and the merge itself is one atomic call
    instead of two separate client requests, closing the "network drops between
    the delete and the update" window PR #79's ordering fix alone could not close.
  - `addToDeck`'s source read is now owner-scoped (the other gap the impact map
    found), and its four hand-branched write shapes (move-whole, split, merge,
    insert) collapse into one `rekey` step — `apply_stack_rekey` picks the
    matching branch itself.
  - `sleeveCopies` and `unsleeveCopies` (`decks/actions.ts`) each now build every
    draw/return as one ordered batch of steps and make a single atomic call,
    closing the shrink-source/grow-destination lost-copies window migration 38's
    header named as the web-side defect left in place pending this work.
    `unsleeveCopies` also now returns `{ unsleeved, error }` instead of `void` —
    it and `removeEntryFromList` (used by `removeDeckCard`, `bulkRemoveEntries`,
    `bulkUnsleeveEntries`, `setDeckCardPrinting` and `unsleeveCard`) no longer
    swallow a write error, the single most severe finding in the impact map.
    Plain `<form action>` callers with no bound state (`unsleeveCard`,
    `removeDeckCard`, `setDeckCardPrinting`) now throw on failure, surfaced by the
    `(app)` route group's existing error boundary; callers that already return
    `DeckState` (`bulkRemoveEntries`, `bulkUnsleeveEntries`) report it as a normal
    failure message, naming how much of the selection completed before the error.
  - `removeEntryFromList` no longer duplicates unsleeve logic inline — it now
    calls `unsleeveCopies` directly, so there is one atomic, error-checked path
    for "take physical copies out of a deck," not two.
  - **Dead code deleted, confirmed via grep for callers first:** `moveCardInstance`
    (`collection/actions.ts`) and `removeFromDeck` (`decks/actions.ts`) — both had
    zero callers anywhere in `src/`, `apps/mobile/src` or `packages/`.
  - **Mobile:** no changes, as the impact map anticipated — `apps/mobile/src/backend.ts`
    never calls any of the rewired functions.
  - **Left for later, not done in this change:** the migration 39 header's stale
    claim about trade deletion behavior (migration 25 changed it to `SET NULL`)
    and the two small mobile bugs the impact map surfaced in passing
    (`apply_stack_move`'s fresh id/`acquired_at` on a whole-pile move,
    `packages/scan-core/src/move.ts:129`'s `notes: null`) — neither was in scope
    for this change and both are already logged above. Testing on a physical
    device was explicitly out of scope for this session; verified instead via
    `npm run test:db` (fresh red-before-green run) and the full unit suite.

- **3, done (2026-09-22).** Migration 40 applied to production the same day this was
  found (`supabase db push --linked`, verified via `supabase migration list --linked`
  showing local and remote both at 40). `npm run check:migrations`
  (`scripts/check-migrations-applied.sh`, #78) now runs in CI on every push to `main`
  and fails the build if this ever drifts again — skips with a warning rather than
  failing when `SUPABASE_ACCESS_TOKEN` isn't configured, which it isn't yet; add that
  secret to make the CI side actually enforce it (the local command already works).

- **4 (a real phone session).** Roughly ten open items below are marked "unverified
  on a device" or depend on it directly: items 2–4/8/12 (old numbering) on the phone,
  the rest of the scanner tuning work (#8), `QUICK_MIN_SCORE`, catalog parse time at
  launch, the now-finally-live "New cards are available" prompt, the `expo-sensors`
  foil-tilt rebuild, phone heat, and a dark-mode contrast pass. Every scanner constant
  in this file was tuned on top of the last one with no measurement — more scanner
  code before this session would just pile on more guesses. **While doing it, capture
  the raw OCR reads** (alternate-art plan step 1) so `npm run accuracy` finally runs
  against real data instead of the illustrative sample.

- **6 (phone: move a copy).** `apply_stack_move`/`createMoveWriter` already exist and
  are tested — this is UI work, not new infrastructure. `beginMove` in
  `AppProvider.tsx` is currently only reachable from deck sleeve/unsleeve, so the
  phone cannot re-file a card from Unsorted into a binder at all, which is the
  product's whole premise, and the owner decision was iPhone-first. Impact genuinely
  depends on whether the owner re-files cards from the phone or the laptop — unknown,
  cheapest way to find out is just noticing which device gets reached for next time.

- **7, done 2026-09-23.** `schema_test.sql` section 22 covers migration 20's
  remaining two tiers — the shortfall falling back to the oldest entry when no
  entry names the exact printing sleeved (tier 2, genuinely untested before:
  falsified by reversing the `ORDER BY` in a scratch copy of the migration,
  confirmed it broke only this new assertion and nothing earlier), and a
  brand-new row when no entry exists for the card at all (tier 3, already
  incidentally covered by section 11 — confirmed by disabling that insert
  branch and watching section 11 fail first — but named and asserted
  explicitly here too, alongside tier 2, in a deck that also carries other
  entries for other cards, which section 11's deck does not). `created_at` is
  set explicitly on the fixture rows rather than left to `now()`'s default,
  since the whole file runs inside one transaction and `now()` is frozen
  across every statement in it — `.claude/rules/migrations.md`'s "Known
  unresolved" section named this as exactly why the oldest-entry tier had no
  test yet.

- **17, done 2026-09-23.** `src/lib/cards/search-query.ts`'s own copy of the
  filter model, the literal-Scryfall-syntax reader, and the colour/loyalty
  matching is gone — it now re-exports `packages/upkeep-domain/src/card-search.ts`
  directly, the same thin-re-export pattern `src/lib/collection/stacking.ts`
  already uses for the stacking policy. Only what has no mobile equivalent
  stays local: `advancedFilterToParams`/`advancedFilterFromParams`, the
  URL round trip (the phone has no URL to round-trip through).
  `src/lib/collection/filters.ts` is untouched — it serves the separate
  collection-filtering feature (`CollectionFilters.tsx` and friends), not card
  search, and duplicates the same colour/numeric primitives for that reason;
  folding it in too was out of scope for this item. All 16 existing
  `search-query.test.ts` cases pass unchanged against the shared
  implementation, confirming the two copies had already been kept in sync by
  hand — this just makes that automatic.

- **18, done 2026-09-23.** `pickRepresentative` (`wants/actions.ts`) picked a
  wish-list entry's default printing by set-type rank then release date only —
  a card's printings inside one set share a release date, so two same-set
  printings (an ordinary card and its foil-only showcase treatment) fell
  through to whatever order the database happened to return. This is the
  identical bug `packages/scan-core`'s `regularFirst` already fixed on the
  scanner side (its header names the real incident: a footer read once opened
  Bloodline Bidding's foil-only showcase printing instead of the ordinary
  card) — the scanner notes under item 8 above call this out as "the web
  wish-list default has the same underlying tie and was left alone." Not left
  alone anymore: the same tie-break (plain collector number, then one
  available nonfoil, then the lowest number) is now applied here too, on the
  now-fetched `collector_number`/`available_finishes`/`set_code` columns the
  old query didn't select. Duplicated rather than imported from `scan-core` —
  that package is not one web code is meant to import from (only
  `packages/upkeep-domain` is shared in both directions, per CLAUDE.md's
  directory map) — with a comment noting the two should stay identical if
  `regularFirst` ever changes. New coverage in
  `scripts/wants-representative-printing.test.ts` (7 cases), since
  `pickRepresentative` had none before.
  - **CI-caught fix, 2026-09-23:** exporting `pickRepresentative` from
    `wants/actions.ts` broke the production build — every export from a
    `"use server"` file must be an async function, and this is a plain sync
    helper. Moved it (with its types and the `isPlainNumber`/`SET_TYPE_RANK`
    helpers it uses) to a new `src/lib/social/representative-printing.ts`,
    imported by `actions.ts` rather than defined there; the test now imports
    from that path instead. No behavior change, `npm run build` confirmed
    clean.
- **6, 13, 15, 19 — a batch of four small phone items, done 2026-09-23, no
  agent used.** All four are contained UI/query work built directly on
  existing infrastructure; none needed an architect gate. Verified by lint,
  typecheck and the unit suite only — **all four are unverified on a real
  device**, same caveat as everything else under item 4, and none was
  observed running on the phone before being marked done.
  - **6 (move a copy).** The actual gap was UI, not infrastructure —
    `apply_stack_move`/`beginMove` already existed and were already tested,
    just unreachable outside deck sleeve/unsleeve. `CardDetails.tsx`'s "In
    your collection" section (already listing every owned stack via the
    existing `fetchOwned`/`OwnedStack`) gets a new `MovePanel` alongside the
    existing "Change printing…" reprint panel, reusing `OwnedStack`'s
    already-loaded fields directly as `StackMoveDraft`'s source. Destinations
    come from `app.locations`, which `AppProvider` already filters to
    non-deck locations — no new query needed. A sleeved stack
    (`locationType === 'deck'`) hides the action entirely; re-filing that copy
    belongs on the deck page, which also updates the deck's list, something a
    plain move knows nothing about. Disabled while another move is pending
    (`app.pendingMove`/`moveBusy`), the same guard `DeckDetailScreen` already
    uses, since both write through the same single-slot pending-move state.
  - **13 (show prices).** `entryPrice` (`@upkeep/domain`) already existed and
    was already used for the dashboard's total — `CollectionScreen.tsx`'s
    list-view row (`CollectionRow`) just wasn't calling it. Added a
    `formatPrice` helper alongside it (mirrors web's `formatPrice` in
    `src/lib/collection/pricing.ts`, which keeps its own copy rather than
    importing this one since it predates this package), with a small new
    test (`packages/upkeep-domain/test/collection-sort.test.ts`). List-view
    only, not the grid tiles — the item's own name ("collection rows") and
    grid density both argue for that scope.
  - **19 (expiring offers).** `dashboard.ts` was already computing
    `tradesAwaiting` with its own inline expiry check instead of the shared
    `isExpired`/`expiringSoon` rule (`@upkeep/domain`) the web dashboard
    already uses for the identical line. Switched to the shared functions and
    added `tradesExpiringSoon` (a subset of the same already-fetched, already
    owner-scoped recipient rows — no new query), surfaced as a second
    "Needs attention" line. Scoped to trades *incoming* to you, matching what
    the existing query already fetches — the web version also considers
    outgoing offers you made, which mobile's query doesn't currently reach;
    widening that was out of scope for this pass.
  - **15 (owned filter, recent searches).** Two independent pieces:
    - *Recent searches*: `pushRecentSearch` (the web header search's pure
      dedup/cap rule, `src/lib/search/recent-searches.ts`) moved to
      `@upkeep/domain` so the phone could share it — same re-export pattern
      `stacking.ts` already uses, with `scripts/recent-searches.test.ts`
      passing unchanged as proof the re-export is faithful. New
      `apps/mobile/src/recentSearches.ts` wraps it in `expo-secure-store`
      (async, unlike web's sync `localStorage`) — deliberately *not* cleared
      on sign-out, since a search term isn't account data.
    - *Owned only*: a new toggle in `SearchOverlay.tsx`, querying
      `collection_entries` for the current result set's names, scoped to
      `owner_user_id` explicitly per CLAUDE.md constraint 3 even though the
      view also legitimately surfaces a friend's tradable rows. One
      unmeasured cost flagged, not fixed: the owned-only query's `.in()` list
      can hold up to ~2000 names for a very broad search (the existing fetch
      cap), which is untested against real Postgres/PostgREST limits — worth
      watching if it proves slow in practice, cheapest to find out from real
      use rather than guessing.

- **24 (tactile playtester), architect impact map + owner decisions, 2026-09-23.**
  Full plan in `PLAYTESTER_IMPLEMENTATION_PLAN.md` (repo root). The architect's
  verdict: **go, with changes** — nothing in it touches a hard constraint, RLS, or
  either reversible bet.
  - **Changed from the plan:** the pure game logic (state/command/reducer/undo)
    goes in `src/lib/playtest/board/`, not a new `packages/playtest-core/` — a
    separate package can't reach `src/lib/playtest/rng.ts` (outside `packages/`),
    so it would either copy the shuffle code or force the extraction the plan
    itself says to defer. This way it shares directly and runs in the existing
    `npm test`. Keep it framework-free by convention, backed by a lint rule (no
    React/Next/Supabase/`@/app/**` imports in that folder).
  - **Changed:** the `playtest_sessions` write policy needs a migration-17-style
    trigger that explicitly compares the session's `owner_user_id` to the deck's
    owner (and checks `type = 'deck'`) — a naive "does this deck exist" check
    would pass for a **friend's public deck** (migration 35) or tradable location
    (migration 9), since RLS legitimately makes those readable. Test the same way
    section 16 already covers a friend-with-public-deck setup, and prove the test
    can fail by removing the owner comparison first.
  - **Added:** a size cap on saved snapshots (~256KB, unmeasured) — as scoped, any
    signed-in user could otherwise post arbitrary JSON and fill the free-tier
    database.
  - **Real risk flagged, not a change to the plan:** 10 components under
    `src/components/decks/` carry server actions that write `card_instances`/
    `deck_cards` (e.g. `DeckBanner.tsx`, `DeckWorkspace.tsx`). Reusing one of them
    on the play page could let a "just a viewer" board accidentally mutate
    physical inventory. The play route gets its own `play/actions.ts` touching
    only `playtest_sessions`, plus a lint rule banning inventory-action imports
    from the playtester folder and the board-logic folder.
  - **Owner decisions (2026-09-23):** deleting a deck deletes its saved games too
    (consistent with decklist deletion already doing this). v1 ships with pure-logic
    + `schema_test.sql` coverage only, no Playwright/E2E — this repo has no
    browser-test setup today, and standing one up is its own separate project.
    The "never touches inventory" guarantee for v1 therefore rests on the
    structural lint-rule boundary, not an end-to-end test.
  - **Also worth doing, not blocking:** store the resulting card order in a
    snapshot, not just its shuffle seed, so a saved game never depends on the
    RNG code staying frozen; identify real cards in a snapshot only by Scryfall
    card ID, never a physical `card_instances` row id, so a future trade can't
    reach into a saved game; settle the battlefield's two overlapping
    representations (`zones.battlefield` vs. the separate `battlefield` array)
    before the snapshot format is fixed in Phase 3.
  - **Timing:** Phases 0–2 (prototype → deterministic core → desktop UI) can
    start now; the `playtest_sessions` migration is Phase 3 and waits until the
    game-state shape has settled through the prototype. Migration numbering:
    coordinate with item 2's `apply_stack_rekey` (migration 41) — whichever
    merges first takes the number.
  - **Simplified, 2026-09-23 (owner):** the "Use sleeved copies only" mode is
    dropped from v1. The playtester always starts from the deck's full
    `deck_cards` list — no capped-quantity generation, no shortfall banner, no
    per-card sleeved-count read, no `source_mode` column, no "deck changed
    since last save" resume prompt tied to sleeve state. `PLAYTESTER_IMPLEMENTATION_PLAN.md`
    updated to match throughout. This removes one of the two start-mode paths
    Phase 1's tests were meant to cover and simplifies `GameState` (no
    `sourceMode` field) and the `playtest_sessions` schema (no `source_mode`
    check column) accordingly.
  - **Phase 1 shipped, 2026-09-23 (implementer).** The deterministic game
    core: `src/lib/playtest/board/` (`types.ts`, `commands.ts`, `reduce.ts`,
    `inverse.ts`, `history.ts`, `selectors.ts`, `shuffle.ts`, `serialize.ts`,
    `fixtures.ts`) plus the pure web adapter `src/lib/playtest/game-start.ts`.
    No UI, no route, no migration — those stay Phases 2 and 3. Notable choices
    made while building, each documented in-file:
    - Resolved the impact map's flagged risk (the overlapping
      `zones.battlefield` array vs. a separate `battlefield` list) at the
      type's birth rather than carrying it forward: a card's board group
      lives on the card itself (`GameCard.groupId`), so there is only one
      representation of battlefield membership from day one.
    - The 11 commands are exactly the set named in the brief (`DRAW`,
      `MOVE_CARD`, `SET_TAPPED`, `SET_FACE`, `ADD_COUNTER`, `CREATE_TOKEN`,
      `DELETE_OBJECT`, `SHUFFLE`, `SET_LIFE`, `NEXT_TURN`,
      `RESTORE_SNAPSHOT`). Anything that would otherwise need randomness at
      apply-time (a token's object ids, a reshuffle's seed) is carried on the
      command itself, which is what keeps replay deterministic.
    - Undo is two independent, deliberately separate mechanisms: `history.ts`
      is the bounded (200-entry) past/future stack of stored states the plan
      recommends as the simplest-correct v1 form; `inverse.ts` computes a real
      per-command inverse for every command that has a cheap exact one — all
      but `DELETE_OBJECT`, `SHUFFLE`, `NEXT_TURN`, and `RESTORE_SNAPSHOT`
      itself, which fall back to restoring the prior state wholesale (reasoning
      in `inverse.ts`'s header).
    - Card object identity in `game-start.ts` is derived from the
      `deck_cards` row id (`${entry.id}:copy:{n}`), not a random UUID, so
      "same input + same seed" reproduces the literal same `GameState`, ids
      included, not just an equivalent one.
    - 43 new tests across 7 files in `scripts/` (`playtest-board-reduce`,
      `-inverse`, `-history`, `-serialize`, `-selectors`, `-shuffle`,
      `playtest-game-start`), covering every item in the plan's Phase 1 test
      list, including the exit criterion itself asserted directly (same seed
      + same commands -> identical state, ids included). `npm run lint`,
      `npm run typecheck` and `npm test` all pass (694 tests total, repo-wide).
    - Deliberately deferred, not forgotten: `src/components/playtester/`, the
      `/decks/[id]/play` route, and the `playtest_sessions` migration
      (Phases 2–3); the "worth doing, not blocking" items from the impact map
      (storing shuffle results rather than replaying the seed at
      snapshot-restore time; identifying real cards in a snapshot only by
      Scryfall id) remain open for whoever builds Phase 3's persistence. The
      lint rule banning inventory-action imports from the playtester/board
      folders (impact map's "real risk flagged") is also not built yet — there
      is nothing under `src/components/playtester/` for it to guard until
      Phase 2 exists.
  - **Reviewed, one finding fixed, 2026-09-23.** `reduce.ts`'s action-log
    entries were keyed with `crypto.randomUUID()`, which quietly broke the
    determinism guarantee the moment any command ran — two runs of "same seed,
    same commands" produced states that matched everywhere except every log
    entry's id. Not a functional bug (undo/redo restores stored states rather
    than recomputing them, so nothing depended on it), but it contradicted
    the claim above and would have mattered for Phase 3's replay/resume story.
    Fixed: the log id is now a sequence number derived from the log's own
    length, so it's deterministic across identical replays (a number can
    repeat only after the entry that previously held it has already been
    dropped by the log's 500-entry cap, which is not a collision). Added a
    test — `playtest-board-reduce.test.ts` — that runs an identical command
    sequence against two independently-created fixtures and asserts the
    resulting states, log included, are byte-identical; this is the actual
    case the initial-state-only reproducibility test didn't cover. 695 tests
    now pass repo-wide, lint and typecheck clean.

- **25 ("Fits this deck"), architect impact map + owner decisions, 2026-09-23.**
  Full spec in `FITS_THIS_DECK_DEVELOPMENT_GUIDE.md` (repo root). Verdict:
  **go, with changes** — no hard constraint, RLS policy, or reversible bet is
  touched.
  - **Real finding, not a hypothetical:** two earlier `cards` column additions
    (migrations 32, 34) landed in the exact 09-12–09-14 window item 1's sync
    write began shrinking its batch size. "Just add a column" is not free
    right now — item 1's write is already near its limit.
  - **Changed from the plan (owner decision):** store only a narrow
    `commander_legality` text column (`legal`/`banned`/`not_legal`), not the
    full Scryfall `legalities` jsonb object. The full object is ~450–500
    bytes/row across ~100k printings (~45MB plus matching WAL/day, architect's
    estimate) — real cost on a write path that already times out on roughly
    half of scheduled runs. The narrow column is ~10 bytes/row and, unlike
    the full object, does not need to wait for item 1 to be healthy first —
    it can be added now, with the recommendation section switched on only
    after one full sync run completes with a verified-near-zero count of rows
    still missing the value (a failed run leaves untouched rows with no
    legality, which the feature must read as "don't know," not "not legal").
  - **Changed from the plan (owner decision):** legality is checked as "any
    free printing the user owns is legal, unless the card is banned" — not
    "the specific printing you happen to own." Scryfall marks gold-bordered,
    oversized and many promo printings `not_legal` even when the card itself
    is fine; checking only the owned printing would wrongly exclude those.
    `banned` stays consistent across printings, so excluding on it alone is
    safe.
  - **Changed from the plan (owner decision):** the "Not for this deck"
    dismiss button is dropped from v1 entirely, not built with a
    `deck_recommendation_feedback` table. An unpersisted dismissal just
    reappears on the next load, which is worse than no button — and skipping
    the table means this feature creates no user data at all in v1, so it
    stays cheap to remove later if it doesn't earn its complexity.
  - **Also decided, lower-stakes:** the section shows for any deck with a
    nominated commander (matching the free-text `locations.format` against
    "commander"/"EDH" for the empty-state prompt) rather than adding a
    controlled format field to the schema; the owner filter on the new
    candidate-pool query is enforced by convention and review, the same as
    the ~25 existing owner-scoped queries in `queries.ts`, not by a new
    SQL function — revisit only if a large collection makes the query slow;
    web-only for v1, with `deck-fit.ts` kept free of Next.js imports so it
    can move to `packages/upkeep-domain` later if the phone ever needs it.
  - **Do not add the new column to the shared `Card` type or `CARD_FIELDS`**
    (`src/lib/types.ts`) — migration 34's `game_changer` did that and it
    forced changes across `collection-filters.test.ts` and
    `deck-stats.test.ts` and widened every collection read. Keep it local to
    the new loader.
  - **Order matters for the migration itself:** apply the migration to
    production, merge the sync-mapping change, then run a forced sync — in
    that order. Landing the mapping change before the column exists in
    production fails every batch of the next scheduled run. (Coordinate
    numbering: `main` is at migration 41 as of PR #82; this branch and item
    24's Phase 3 migration are both still waiting on a number.)
  - **Housekeeping note:** this branch (`feat/playtester-phase1-game-core`,
    PR #83) branched before PR #82 merged, so its copy of this file's item 2
    row/notes are stale relative to `main`. Reconcile on merge — this is a
    known, expected conflict, not a sign anything is wrong.
  - **Not yet started:** no implementer work has begun on item 25. This
    entry records the architect's impact map and the owner's sign-off only.

- **9 (otags), re-scoped.** Otags are a real, free, official Scryfall bulk file
  (`oracle_tags`, ~5.7MB gzipped, daily, no rate limit, 99.4% coverage) — genuinely
  Moderate, not Hard. Plan unchanged: two tables keyed on the tag UUID (slugs aren't
  stable), a separate `scripts/sync-oracle-tags.ts`, a new migration, first feature a
  collection filter. **Rule: paid tiers may gate the user's own collection features,
  never Scryfall card data** (their terms). The real blocking condition on #1 is not
  "one green run" (already true) but "the write path is healthy again" — more columns
  per row is more work per write, and #1 shows that write is already near its limit.

- **10 (Mobile UI refinement brief), Priority 3 shipped, 2026-09-23
  (implementer), on `feat/mobile-collection-filter-sheet` off `main`.**
  Priorities 1, 2 and 6 shipped earlier the same day on `feat/mobile-unified-
  header` and `feat/mobile-settings-menu-refinement`, neither merged to `main`
  yet — this branch was cut from `main` directly, so it carries none of that
  code and this entry documents only Priority 3.
  `CollectionScreen.tsx`'s filter panel used to be an inline `ScrollView`
  clamped to `Math.min(340, windowHeight * 0.4)` inside the list's scrolling
  header — on a short screen this held it to 40% of the height, clipped the
  lower filter groups, and gave no clear signal that the panel itself
  scrolled (the brief's actual complaint). It is now a bottom sheet with a
  fixed header (title + close), a scrolling body (the same seven groups:
  Colors, Where it is, Rarity, Finish, Condition, Type, Set code — the
  brief's Color/Location/Rarity/Finish/Condition/Type/Set grouping already
  matched; only the sheet changed, not the grouping or its labels, since
  relabeling wasn't asked for and this pass is a restructuring, not a copy
  pass), and a fixed footer (a "Reset" button, shown only while a filter is
  active — unchanged from the old "Clear filters" condition — beside a
  primary "Show N entries" button that closes the sheet, N being the live
  `entries.length` after the same `filterCollection`/`sortCollection` the
  screen already ran).
  - **Built as a reusable primitive, not a filter-specific component.**
    `BottomSheet` lives in `components/ui.tsx` alongside the app's other
    shared primitives (`Button`, `Choices`, `EmptyState`, `Notice`), taking
    `title`/`footer`/`children` so any future large sheet of controls can
    reuse it rather than everyone re-deriving `MenuSheet`'s animation
    plumbing. Reasoning for building it generic: the brief's Priority 2
    (Settings' compact slot picker, shipped separately on the unmerged
    settings branch) is exactly the second candidate for a bottom sheet this
    app already has, so a filter-only component would likely have been
    redone or duplicated the moment that branch merges. The primitive
    intentionally does not try to unify with `MenuSheet.tsx` itself (side-
    slide, no footer, no scroll body) — mirroring its Modal/Animated.View/
    scrim shape rather than trying to generalize both into one component was
    judged the smaller, safer change.
  - **No drag-to-dismiss, no snap points.** A fixed open/closed animated
    sheet, the same shape `MenuSheet.tsx` already uses, per the task's own
    "don't over-build it" guidance — nothing in this app needs a snap point
    today.
  - **No draft state.** The sheet reads and writes the screen's existing
    `facets` state directly, the same object the toolbar's Filters button and
    the badge already read. Applying, resetting, and closing all require the
    same number of taps as before (arguably fewer: "Show N entries" doubles
    as the sheet's own close action). Canceling by tapping the scrim or the
    header's close button also just closes the sheet with whatever `facets`
    already held — since there is no draft to discard, "returning to the
    collection retains the selected filters" falls out with no extra code,
    exactly as the task anticipated.
  - **Height is proportional (`windowHeight * 0.85` by default), not a fixed
    pixel value** — same reasoning `MenuSheet.tsx` already applies to its own
    width via `useSafeAreaInsets`/`useWindowDimensions`, so the sheet cannot
    clip on the smallest supported phone height or under larger text
    settings; the body's `ScrollView` absorbs whatever the header/footer
    don't leave room for; long content (many locations, a wrapped color row)
    scrolls inside the fixed frame instead of pushing the footer off-screen.
  - **Sort panel and view toggle untouched.** `showSort`/`collectionSort` and
    the grid/list `Ionicons` toggle in the toolbar are exactly as before —
    out of scope per the task, and nothing about them changed shape.
  - **Verified:** `npm run lint` and `npm run typecheck -w @upkeep/scanner-app`
    both clean on the two touched files (`components/ui.tsx`,
    `screens/CollectionScreen.tsx`); the root `npm run lint` run also reports
    hundreds of pre-existing errors, all of them under `.claude/worktrees/**`
    — other agent sessions' checkouts that this repo's `eslint.config.mjs`
    does not exclude, not this change; confirmed by linting the two touched
    files directly, which come back clean. `npm test` — 702/702, unaffected
    (no pure logic was extracted; this is a presentational restructuring of
    an existing panel, as scoped). No schema touched, so `npm run test:db`
    does not apply.
  - **Visual verification hit the same wall documented under Priority 1
    above.** Metro was already running on 8081; the dev-client build was
    already installed on a booted simulator and launched cleanly, but its own
    connection screen showed the "Open in 'Project Upkeep'?" system
    confirmation dialog this session cannot dismiss — no tap-injection tool
    in this sandbox can drive a system alert, only the app's own rendered UI
    once inside it (matching this file's existing note that a *different*,
    unrelated obstacle — a stale baked-in tunnel URL — blocked the same last
    attempt; here the server address shown was live, not stale, but the
    system dialog itself was the wall this time). Verified instead by reading
    the code closely: `BottomSheet`'s header/body/footer split, its
    `useSafeAreaInsets`-driven height, and `CollectionScreen`'s direct binding
    to `facets` were all traced by hand rather than seen rendered. Left for
    the owner's own device session (item 4): confirming the sheet's actual
    on-screen proportions, that the scroll affordance reads as a scroll (not
    just structurally guaranteed not to clip), and that "Show N entries"
    updates smoothly as filters change on a real phone.
- **10 (Mobile UI refinement brief), Priorities 2 and 6 shipped, 2026-09-23
  (implementer).** Batched deliberately, as scoped: neither depends on the
  other or on any new shared primitive, and both are self-contained inside
  one screen/one component each. Priority 1 (the unified header) shipped
  separately and earlier the same day on `feat/mobile-unified-header`, still
  unmerged as of this branch — this work does not depend on it and touches
  none of the same files. Priorities 3 (collection filter sheet), 4
  (spacing/typography tokens), 5 (bordered containers) and 7 (interaction
  polish) were left untouched, per scope.
  - **Priority 2 (Settings screen).** `SettingsScreen.tsx`'s "Navigation bar"
    section used to render a full `Choices` row of all ~9 pinnable pages for
    each of the four configurable slots — the whole destination list,
    repeated four times on one screen, exactly the brief's complaint. It's
    now a compact five-position preview (`NavSlotPreview`): two chips, a
    fixed non-tappable Scan chip in the middle (accent-filled, matching its
    permanent centre position in the real tab bar), two more chips — each
    configurable chip shows its current page's icon and label directly, and
    tapping one opens `SlotPicker`, a small centered modal listing the
    pinnable pages once, for that one slot only. Labels are the brief's own
    suggestion verbatim — "Left 1," "Left 2," "Right 1," "Right 2" — replacing
    "First tab"/"Second tab"/"Fourth tab"/"Fifth tab"; kept as accessibility
    labels and the picker's modal title even though the preview's icons and
    text carry the visible meaning day-to-day.
    - **Duplicate handling: read `setSlot` before deciding, per the task's own
      instruction.** `preferences.tsx`'s `setSlot` already swaps the two
      slots when the chosen page sits elsewhere in the bar (`readSlots`
      itself enforces four *distinct* pinnable pages as its validity check,
      so a duplicate was never actually reachable in stored state, only
      transiently unless swapped). That's the simpler of the brief's two
      options ("prevent" vs. "explain") already in place — no new duplicate
      logic was needed. `SlotPicker` just makes the existing swap legible: a
      non-selected row that's currently pinned to another position shows
      "swaps with Left 2" (etc.) inline, so nothing surprising happens
      silently.
    - "Reset to default" stays a `secondary`-variant button, now visually
      minor beneath the compact preview rather than beneath four stacked
      chip rows.
    - Appearance, Welcome, Account, account deletion and Card Database
      sections are untouched beyond the Navigation bar section shrinking
      around them, per the brief's explicit instruction to keep that
      grouping; account deletion's own card is unchanged and still visually
      separated from routine settings.
  - **Priority 6 (menu organization).** `MenuSheet.tsx` rendered `MENU_ORDER`
    (twelve destinations) as one flat list. `MENU_ORDER` does include `Scan`
    — it's a real page and a real menu entry, just also the tab bar's fixed
    centre button rendered separately by `TabBar.tsx` — so the brief's
    "Primary: Scan, Dashboard" grouping maps directly onto the app's actual
    page list with nothing dropped or reinterpreted: `MENU_GROUPS` is
    `Primary: Scan, Dashboard` · `Library: Collection, Locations, Decks,
    Search, Wishlist` · `Social: Friends, Trades, Notifications` · `Tools:
    Import, Settings` — the brief's suggested structure verbatim. A `__DEV__`
    check compares `MENU_GROUPS`' flattened contents against `MENU_ORDER` and
    warns if either ever drifts out of sync (an id dropped or duplicated
    across groups), since nothing else enforces that the two stay a clean
    partition as pages are added later. Section labels are small, low-contrast
    (`type.label` at reduced opacity, uppercase) — no separators, no added
    borders, no heavier visual weight than the previous flat list. The
    per-item `Pressable` (selected highlight via `itemSelected`/`accent.soft`,
    the unread-notification badge on Notifications, the "Soon" tag for
    unbuilt pages) is entirely unchanged — only the surrounding `ScrollView`
    structure changed, from one flat `.map` to a `.map` over groups each
    containing their own `.map` over pages.
  - **Verified:** `npm run lint` clean on both touched files (the full
    `npm run lint` run separately surfaces ~775 pre-existing errors across
    unrelated files, some under a different worktree path entirely — not
    touched, not introduced by this change); `npm run typecheck -w
    @upkeep/scanner-app` clean; `npm test` — 702/702, unaffected (screens-only,
    no pure logic changed, so no new `scripts/*.test.ts` was warranted, per the
    task's own instruction not to manufacture one). No schema touched, so
    `npm run test:db` does not apply.
  - **Simulator attempt hit the same stale dev-client tunnel URL Priority 1's
    entry above already documents** — the Expo dev-client fell back to a
    stale `*.exp.direct` address baked into the installed native build rather
    than the running local Metro packager (confirmed serving at
    `localhost:8081`), and this sandboxed session has no
    accessibility/UI-automation permission to tap through the dev-client's
    "Open in Project Upkeep?" confirmation dialog to work around it. Not a
    finding about this diff — a native-build/tooling gap already known from
    the same day's earlier attempt. **Left for the owner:** an on-device look
    at the compact nav-slot preview, the slot picker, and the grouped menu —
    verified here instead by close reading: `NavSlotPreview`/`SlotPicker`
    read and write through `usePreferences()`'s `slots`/`setSlot` exactly as
    the rest of Settings always has, and `MENU_GROUPS`' four arrays were
    checked by hand against `MENU_ORDER`'s twelve ids for a clean partition.
  - **Reviewed, one finding fixed, 2026-09-23.** Everything above checked out
    on independent review — the `setSlot` swap claim was traced by hand with
    a concrete example, the menu partition was re-checked against the real
    `MENU_ORDER`. One real gap: the `__DEV__` drift-check's own comment
    claimed it caught "an id dropped or duplicated across groups," but
    `.includes()` alone only catches an id going missing — a real id
    appearing in *two* groups at once (nothing else dropped) left both
    `missing` and `extra` empty, since the duplicate is still present
    somewhere and still a member of `MENU_ORDER`. Not a live bug (no
    duplication exists in `MENU_GROUPS` today), just a weaker safety net
    than documented for whoever edits this next. Fixed by checking
    `grouped.filter((id, i) => grouped.indexOf(id) !== i)` for `duplicates`
    alongside the existing `missing`/`extra` checks — confirmed by hand
    against the exact scenario the review described (a page duplicated into
    two groups with nothing else dropped) that it now reports the
    duplicate. `npm run lint`, `typecheck -w @upkeep/scanner-app` and
    `npm test` (702/702) all still pass.
- **10 (Mobile UI refinement brief), Priority 1 shipped, 2026-09-23
  (implementer).** The unified Mort-centered header (`MOBILE_UI_REFINEMENT_BRIEF.md`'s
  Priority 1, plus its "Navigation integration" subsection pulled forward as
  scoped): `AppHeader.tsx` now renders three fixed 44pt regions — a back
  chevron or reserved space, Mort at 42pt on his existing `accent.soft`
  circle, and the menu button — instead of the old title bar. It replaces the
  mixture of that branded header and React Navigation's native detail headers
  everywhere signed in; the live scanner's own dark camera chrome
  (`ScanScreen.tsx`) was not touched.
  - **Titles moved into content, not duplicated.** Every root screen
    (Dashboard, Collection, Locations, Decks, Wishlist, Friends, Trades,
    Notifications, Import, Settings, and the "coming soon" placeholder) now
    shows its own title at the top of its content in the existing 28pt Cinzel
    display type, via a new shared `components/PageTitle.tsx` — one place to
    keep that in sync rather than a copy-pasted style per screen. Detail
    screens that already had a hero/banner title with real hierarchy
    (`DeckDetailScreen`'s commander banner, `TradeDetailScreen`/
    `TradeBuilderScreen`'s own heading) keep that instead of adding a second
    one, per the brief's own "never show a title twice" rule. The two detail
    screens that had neither (`LocationDetailScreen`, `FriendProfileScreen`)
    now show one, sourced from the same route param the native header used to
    display (`route.params.title`, `route.params.username`) so nothing that
    was visible before silently disappeared.
  - **Navigation integration.** The native header is now off
    (`headerShown: false`) on all four of `App.tsx`'s nested stacks — Decks,
    Locations, Friends, Trades — so nothing can show the old "branded header
    above a native back bar" double-header condition again; there is now
    exactly one header component in the whole signed-in app outside the
    scanner. Back-button visibility and the swipe-back gesture are two
    independent things: which the new `getHeaderBackInfo` in `navigation.ts`
    computes from the navigator's own state (whether the focused tab's nested
    stack has pushed past its root screen) on every `onStateChange`, purely to
    decide whether `AppHeader` shows a chevron; the swipe gesture itself is a
    native-stack property that hiding the header does not touch, so it kept
    working unmodified. The chevron calls `navigationRef.goBack()` — the
    standard React Navigation pattern for a back button that lives above the
    navigator rather than inside one of its screens.
  - **Verified:** `npm run lint` and `npm run typecheck -w @upkeep/scanner-app`
    both clean on every touched file (two pre-existing warnings elsewhere,
    unrelated to this change); `npm test` — 702 tests, unaffected (this is a
    screens-only change, nothing in `src/lib`-equivalent pure logic moved).
    No schema touched, so `npm run test:db` does not apply. Booted the iOS
    Simulator and installed the existing dev-client build alongside Metro:
    confirmed the app installs, launches and Metro serves the edited bundle
    with no build/transform errors. Could not get past the Expo dev-client's
    own connection screen to see a live screenshot of the header — the
    simulator here has no way to simulate a touch (no Accessibility/Automation
    permission available in this environment for UI scripting, and there is
    no bundled tap-injection tool), which blocked confirming this visually
    rather than any problem found in the app itself.
  - **Left for the owner:** on-device/signed-in visual confirmation of the
    header and its back button on Deck Detail, Location Detail, Friend
    Profile and Trade Detail/Builder specifically (this session had no
    credentials for the real, production-backed account) — the code path for
    each was read closely (native header off, `getHeaderBackInfo` covers all
    four stacks, each screen's title source is correct) but never seen
    rendered. Also left alone, deliberately, as outside this task's scope:
    Priorities 2–7 of the same brief (Settings screen, collection filter
    sheet, spacing/typography tokens, bordered containers, menu grouping,
    interaction polish), and the brief's optional "a subtle divider once
    content scrolls beneath the header" — the header is canvas-coloured with
    no border today, which satisfies the brief's default state; wiring a
    scroll listener into every screen's list/ScrollView for the scrolled
    state would have meaningfully widened this change's surface for a detail
    the brief itself calls optional ("may appear").
  - **Reviewed, 2026-09-23 — clean, no findings above "preference."**
    Independently re-verified `npm run lint`/`typecheck`/`npm test`
    (702/702), and confirmed by direct code reading (not the implementer's
    summary): the two side regions really are fixed-width `View`s with the
    chevron rendered conditionally *inside* the left one, so Mort's
    centering doesn't depend on a swapped wrapper; `headerShown: false` is
    set once per navigator (not per screen), so every current and future
    screen in all four stacks is covered; Mort has no `onPress` anywhere and
    is genuinely hidden from accessibility; both header buttons are true
    44×44 boxes, not just `hitSlop`; `ScanScreen.tsx` has zero diff. One
    documented, non-blocking tripwire: `getHeaderBackInfo` only looks one
    level into a tab's nested stack, which is correct for today's shape but
    would silently stop showing the chevron if any of the four stacks ever
    grew a third screen level — already called out in the code's own
    comment, not a surprise for whoever touches this next.
  - **A second attempt at simulator verification (parent session, not the
    implementer), same result.** Booted a simulator myself with real
    tap/screenshot tools (rather than the implementer's sandbox, which had
    none) and tried to reach the header past the Expo dev-client's connection
    screen — tapping the correctly Bonjour-discovered local Metro server,
    and a clean uninstall/reinstall of the dev-client build, both still fell
    back to a stale `*.exp.direct` tunnel URL baked into this particular
    native build from however it was last compiled. That's a native-build/
    tooling gap unrelated to this diff — fixing it means a fresh native
    rebuild, out of proportion for screenshotting a header — not a finding
    about the code. The four signed-in detail screens still need the
    owner's own eyes, as above.

## Owner decisions — evergreen facts, kept for future work

These are architectural decisions that remain true and load-bearing; the step-by-step
"done" diaries that used to sit here have been moved to their PRs (#71–#76) where the
full detail lives.

- **Reprint (old item 6), fully shipped web + mobile, PRs #71/#72/#73.** Its own
  row-menu action, never a field on the edit form — the edit form's "quantity" means
  *set the stack to N*, every atomic stack function's "quantity" means *move N
  copies*, and conflating them is exactly the migration-20 deck-inflation hazard (see
  item 2 above, which is that same hazard reached through a *different*, still-unfixed
  path). Sleeved status is tracked by `oracle_id`, not by printing, so a reprint never
  un-sleeves a card. `accept_trade` reads `card_id` live at accept time, not from a
  snapshot, so an in-place reprint is blocked outright while the copy sits in an open
  trade — otherwise the counterparty would receive a different card than the trade UI
  showed them. No `ownership_history` row: that table has no insert policy (only
  `accept_trade` writes it) and nothing was transferred; the audit trail is
  `collection_write_ops` with `kind = 'stack_reprint'`. **Order is load-bearing:**
  clear the source stack before incrementing the destination, or the same migration-37
  trigger that inflated the deck list in item 2 does it here too — `apply_stack_reprint`
  (migration 39) gets this right, which is exactly the bug `bulkMerge` still has.
- **Languages (old item 8), fully shipped, PRs #74/#75/#76.** All 49 Phyrexian
  printings and every other language were already in `cards`; set + collector number
  are identical across languages, so no catalog change was needed, only display,
  a trade-snapshot column, and a footer-first scan fallback. Deliberately **not**
  done: switching to Scryfall's `all_cards` export (4.6x the rows, ~30 min upsert in a
  45-min job, well over the free Postgres tier — and item 1 shows the current row
  count is already straining writes) or an all-language mobile catalog (210MB vs an
  80MB cap). Looking a card up by its Japanese name is a separate, much larger
  request, not done. Wish-list matching stays language-agnostic; only display shows
  the language. The scanner-facing half (steps 3–4) is unverified on a physical
  device — see item 4.
- **9 (leaderboard).** Duplicates and extends the in-app feedback button. With one
  user, votes carry no signal — the cheapest way to find out if it's wanted is to ask
  once there are real users, not to build it speculatively.

## Dropped from this file (2026-09-22)

- ~~Deck details, share switch, rename, delete~~ — done on mobile
  (`DeckDetailScreen.tsx`, `DeckDetailsEditor.tsx`, `renameDeck`/`updateDeckDetails`/
  `setDeckPublic`/`deleteDeck` in `decks.ts`).
- ~~Collection sort options~~ — done (`CollectionScreen.tsx`, `sortCollection`).
- ~~Wish-list quantity~~ — done (`WishlistScreen.tsx`, `setWantQuantity`).
- ~~`latest.json` has never been published~~ — stale; published 2026-09-22 (both the
  00:55 and 23:59 runs). Only the in-app "New cards are available" prompt itself is
  still unverified — folded into item 4 above.
- ~~Run `catalog:snapshot` before every native build~~ — a release procedure, not
  backlog work; `.claude/rules/mobile.md` already documents it, keep it there.
- ~~Housekeeping: support address~~ — done, `src/lib/support.ts` already has the real
  address.
- ~~Phone Find page~~ — folded into item 6 above; the card details sheet already
  shows where each owned copy is and which friends have/want the card, so a separate
  page would mostly repeat it. This is inferred from the code, not confirmed against
  what the owner would actually reach for.
- ~~"Just the changes" catalog update~~ — parked until item 4 actually measures
  whether the 40MB download is too heavy on a phone.

## What could not be determined without more access or a device

- Whether the owner's own collection already has duplicate rows or an inflated deck
  list from the bugs in item 2 — needs a direct read-only database query, not run yet.
- What is actually slowing the sync's database write in item 1 — migration 33 is a
  lead, not a confirmed cause.
- Whether any scanner tuning constant is actually right — needs item 4, a real phone
  session.
- Whether the owner files cards or builds decks from the phone or the laptop — decides
  the real priority of items 6, 11 and 16; no usage data exists to answer this from
  the code alone.

---

The sections below are supporting technical detail for items in the table above —
constants, file paths and tuning notes worth keeping, organised by area rather than
by priority. Consult the ranked table above for what to actually work on next.

## Scanner (supporting detail for items 4, 8, 21, 22)

- Alternate-art accuracy: quick scan reads the footer, opens on a footer-based
  best-guess printing at once, and compares the card's picture with each candidate's
  in the background, switching only when confident (2026-09-19 owner decision dropped
  the "Which printing is this?" picker). Still open: the main Scan tab doesn't use the
  picture step; a sharper still-photo footer capture; printing-type flags in the
  catalog (needs a migration); the 20–30 real-card test set that turns the accuracy
  script's sample numbers into evidence.
- Quick scan capture feel: built for a card held in the hand. No outline while
  searching; after 3 valid detections not being swept through (`BurstTracker`, 0.05
  loose movement), every frame is straightened and the first with sharpness >= 40 is
  read, else the sharpest at 0.7s (if >= 20) or 1.2s regardless; green outline held
  0.35s; box 320x440; a live coaching line at the top (`onScanStatus`). Tune from real
  use: `BurstTracker` constants, `minimumSharpness`, the area floor (0.18),
  `STATUS_MIN_MS` (400).
- "Couldn't read that clearly": focus/exposure/zoom are re-applied after every preset
  change and follow the tracked card; zoom is off (`quickZoomCap` 1.0); frames are
  skipped while the lens hunts (<= 0.6s); blurry 1.2s fallbacks are retried (<= 2); a
  rejected read is retried on the held card (`retryToken`, 0.4s) silently, then after
  4 retries advises more light / less glare. Title reads from the top 23% of the card.
  To confirm on a phone: focus-point orientation, whether `focusPointOfInterest` is
  zoomed- or full-field-relative, the zoom the device actually picks.
- Wrong printing on quick scan (Bloodline Bidding ECL #91 opened ECL #385): default is
  now the regular print (`regularFirst`), the picture switch needs a 0.75 ratio (0.5
  over a footer guess), a footer-only second OCR pass runs on the 1080p card.
  Unverified on a device: whether the footer reads correctly at 1080p, and the ratios.
  The web wish-list default (item 18) has the same underlying tie and was left alone.
- `QUICK_MIN_SCORE`/`QUICK_AMBIGUITY_MARGIN` (`packages/scan-core/src/band.ts`): tune
  against real cards; check lock-on speed in poor light.
- Accuracy benchmark (offline, no phone): `npm run accuracy -w @upkeep/scan-core`
  sweeps both constants over labelled OCR reads, reporting exact / right-card-wrong-
  printing / wrong card / abstained. The bundled `scripts/fixtures/` sample is
  illustrative only until real device reads replace it.
- Haptics on the fan-out button: needs a native package and a rebuild — bundle into
  whichever rebuild happens next (item 4 or the `expo-sensors` one below).
- Android: no live scanner exists at all (`UpkeepScannerView` is iOS-only); only the
  photo `readText` path exists and nothing currently calls it.

## Card database

- Catalog parse time at launch is unmeasured on a real phone (item 4).
- If the 40MB catalog download proves too heavy: a delta ("just the changes") update
  — parked until that's actually measured.

## Native rebuilds waiting on a phone

- `expo-sensors` (foil tilt) was added after the last phone build — the tilt only
  works once rebuilt; until then the foil responds to a finger drag instead.

## App shell and polish (supporting detail for item 10)

- Dark mode: needs a contrast audit on real hardware (item 4).
- No automated tests exist over mobile screens (item 20) — only the shared logic in
  `packages/*` is tested.
- The web app's search parser (`src/lib/cards/search-query.ts`, ~322 lines) still
  duplicates the shared one in `packages/upkeep-domain/src/card-search.ts` (~249
  lines) instead of using it — item 17. The same query can give different results on
  web and phone until this is fixed.
