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
| 1 | Daily sync: the database write is failing, not just the export step | Med | High | Open — diagnosis needs redoing | `scripts/sync-scryfall.ts`, migration 33 |
| 2 | Collection actions can corrupt deck lists and duplicate rows | Med | High | Open — live bugs | `collection/actions.ts`, `bulk-actions.ts`, `decks/actions.ts` |
| 3 | Migration 40 is merged but not applied in production | Trivial | Low (this migration) / High (the pattern) | Open | `supabase/migrations/00000000000040...` |
| 4 | One real session on a physical iPhone | Owner only | High | Blocks ~10 other items | scanner, item 8 steps 3–4, dark mode |
| 5 | Items 2–4 (old numbering): web sub-menus, printing photos, flip button | Easy | Medium | Owner only — built in PR #69, needs a look | web pages |
| 6 | Phone: move a copy to another binder/box from the card details sheet | Easy–Med | High (if used) | Open | `CardDetails.tsx`, `apply_stack_move` |
| 7 | Migration 20: test the deck-list shortfall's 2nd and 3rd tiers | Easy | Medium | Open | `schema_test.sql` |
| 8 | Rest of the scanner alternate-art plan | Med | Med–High | Mostly blocked on #4 | `SCANNER_ALTERNATE_ART_PLAN.md` |
| 9 | Import all Scryfall data, including oracle tags (otags) | Med–Hard | Med–High | Blocked on #1 | sync + schema + search |
| 10 | Mobile UI refinement brief (7 items) | Varies | Medium | Ready | `apps/mobile/src/components/AppHeader.tsx` + brief |
| 11 | Phone deck gaps: add-to-deck from card sheet, deck wish list, stats, export, playtest | Med each | Low–Med | Open — depends on owner's habits | `apps/mobile/src/screens/DeckDetailScreen.tsx` |
| 12 | Phone quick-add straight to a deck | Easy–Med | Low–Med | Partly done | `ScanScreen.tsx` |
| 13 | Phone collection rows: show prices | Easy | Low | Open (data already loaded) | `CollectionScreen.tsx` |
| 14 | Phone Settings: change password / notification prefs | Easy–Med | Low | Open | mobile Settings |
| 15 | Phone search: filter by owned, recent searches | Easy | Low | Open | mobile search |
| 16 | Phone import: into a deck, pick a file | Med | Low | Open | `ImportScreen.tsx` |
| 17 | Web search should use the shared `packages/upkeep-domain` parser | Med | Low–Med | Open | `src/lib/cards/search-query.ts` |
| 18 | Web wish-list default picks the wrong printing on a tie | Easy | Low | Open | `wants/actions.ts` |
| 19 | Phone dashboard: "expiring offers" line | Easy | Low | Open (data already loaded) | `dashboard.ts` |
| 20 | Automated tests over mobile screens | Hard | Low for now | Later | — |
| 21 | Haptics on the Scan fan-out button | Easy (needs rebuild) | Low | Later — bundle into next rebuild | — |
| 22 | Android live scanner | Hard | Low | Later — no Android user yet | `packages/upkeep-vision` |
| 23 | Public leaderboard with votes | Hard | Unmeasurable | Later | needs `is_admin()` first |

Items 5, 6 and 8 (old numbering) are fully shipped as of 2026-09-22 (PRs #71–#76) and
are dropped from this table — see "Owner decisions" below for what future work should
know about them, not what's left to do.

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

- **2 (collection actions can corrupt data).** All four bugs live in
  `src/app/(app)/collection/actions.ts`, `bulk-actions.ts` and
  `src/app/(app)/decks/actions.ts`, and the safe, already-existing pattern
  (`apply_stack_addition`/`apply_stack_move`, a stacking *decision* in
  `packages/upkeep-domain` then an atomic RPC) is not used by any of them.

  - **Worst: `bulkMerge` can permanently inflate a deck list.** It raises the kept
    row's `quantity` to the combined total, *then* deletes the absorbed rows
    (`bulk-actions.ts:239–252`) — confirmed by reading it directly. Migration 37's
    trigger reacts to that first update, sums every row still physically in the deck
    (migration 20) while the about-to-be-deleted rows are still there, and raises the
    deck's tracked count — which the trigger only ever raises, never lowers. Example:
    4 Forests sleeved as two stacks of 2; merging them makes the list say 6, and it
    stays 6. This is exactly the ordering hazard migration 39's header and schema-test
    section 19 were written to prevent for reprints — the fix here is the same:
    decrement/delete the source(s) before the destination gains anything. Deck rows
    are reachable through this button — `queries.ts` only excludes them when
    "available only" is on.
  - **`updateCardInstance` creates duplicates, not corruption.** Editing a copy's
    condition/finish/language/location to match a stack you already own leaves two
    identical rows instead of merging (`actions.ts:186–196`) — confirmed. Lower
    severity alone (nothing lost, just a wrong-looking row), but it's the *obvious*
    next step for the user to reach for "Merge duplicates," which walks straight into
    the bug above if the stack is sleeved. The new "Change printing…" action sits in
    the same row menu and *does* merge correctly, so the two now visibly disagree.
  - **The same missing-merge bug, three more places:** `bulkMove` (`bulk-actions.ts:87`),
    `bulkSetField` (`bulk-actions.ts:154`), `removeFromDeck`
    (`decks/actions.ts:339`, which also swallows its own errors).
  - **Sleeving into a deck on the web can lose copies.** The web sleeve action
    (`decks/actions.ts:288–317`) does the shrink-source / grow-destination write as
    two separate requests; if the second fails, those copies are gone. The mobile app
    already does this safely through `apply_stack_move` — the web path needs the same.
  - **Dead code:** `moveCardInstance` (`actions.ts:367`) has no callers and swallows
    errors. Delete it.
  - **Unknown, and worth checking before anything else here:** whether the owner's own
    collection already has duplicate rows or an inflated deck list from past use of
    these actions. A read-only query grouping `card_instances` by card/condition/
    finish/language/location and counting groups >1 would answer this cheaply — not
    yet run (needs direct database access this session didn't have).

- **3 (migration 40 not applied).** `supabase migration list --linked` confirms
  1–39 applied remotely, 40 (the item-8 trade-language snapshot, merged today) still
  local-only. Nothing reads `trade_items.language` yet, so production isn't visibly
  broken — but this is the exact same slip the owner's own notes record for
  migrations 36–38 (which broke adding cards). Apply it, and consider a release-time
  check that fails loudly when local and remote migration counts disagree.

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

- **9 (otags), re-scoped.** Otags are a real, free, official Scryfall bulk file
  (`oracle_tags`, ~5.7MB gzipped, daily, no rate limit, 99.4% coverage) — genuinely
  Moderate, not Hard. Plan unchanged: two tables keyed on the tag UUID (slugs aren't
  stable), a separate `scripts/sync-oracle-tags.ts`, a new migration, first feature a
  collection filter. **Rule: paid tiers may gate the user's own collection features,
  never Scryfall card data** (their terms). The real blocking condition on #1 is not
  "one green run" (already true) but "the write path is healthy again" — more columns
  per row is more work per write, and #1 shows that write is already near its limit.

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
