# Playtester build handoff

Written so a fresh AI tool with **no memory of the conversation that started this** can pick the build up and finish it.
Keep this file truthful: update the checklist and the "what remains" section in the same commit as the work.

Last updated: 2026-09-25, after the follow-up pass (zone overlay drag, table look, zoom/keyboard checks, scratch-database contract check).

## Goal, and the one-pass rule

Build the Archidekt-style solo playtester (`/decks/[id]/play`) in **one pass on one branch**. No phased releases, no
batching into separate PRs; one commit per build step so the diff can be reviewed in pieces. The builder does NOT push,
does NOT open a PR, does NOT apply any migration to production, and does NOT edit `apps/mobile/docs/BACKLOG.md`
(the coordinator does those after review). Every diff goes to the `reviewer` agent before it is merged.

Product spec: `ARCHIDEKT_PLAYTESTER_DEVELOPMENT_GUIDE.md` (P0, P1, P2, M0 to M5, definition of done).
Signed-off architecture (authoritative for schema, RLS, file layout, command set, build order, redaction, lint
boundaries): `PLAYTESTER_ARCHITECT_MAP.md`. Product baseline: `PLAYTESTER_IMPLEMENTATION_PLAN.md`.
Repo rules: `CLAUDE.md` and `.claude/rules/{migrations,app-router,testing,data-access}.md`.

Visual reference (an Archidekt screenshot that is deliberately NOT committed): a full-screen dark table; top-left
"Playtester actions" and "Keybinds"; top-right "Full interaction log"; a bottom hand row with a round undo button at
one end and a round redo at the other, "Cards in hand: N" and "Hand options"; bottom-right Library (N) / Graveyard /
Exile piles with "No cards" placeholders and a docked "View other zones" tab; a bottom toolbar with a game menu, life,
poison / experience / energy, coloured mana-pool counters, "Next turn" and "More". Match the LAYOUT only, in Project
Upkeep's own tokens and components (`src/components/ui.tsx`, `src/app/globals.css`). Never copy Archidekt art or branding.

## Where the work lives

- Branch: `feat/playtester-archidekt-parity`, created off `main` at `2ea8d74`.
- It was built in the git worktree `/Users/anthonytalpak/ProjectUpkeep/.claude/worktrees/agent-a90a0ed56184b2d1f`.
  To continue: `git worktree list` from the main checkout, then work inside that worktree, or
  `git checkout feat/playtester-archidekt-parity` in any clone that has the branch.
- This worktree now has its own ignored `node_modules` from `npm ci --offline --ignore-scripts` to run checks. Never
  `git add -A`; add paths explicitly.
- Owner owns commits/pushes/PRs. Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

## Owner decisions (already taken, do not reopen)

- Shares are readable by **signed-in users with the link only** (option B). No anon grant, no `PUBLIC_PATHS` change,
  `get_playtest_share` executable by `authenticated` only. This overrides any "anonymous read" wording in the guide.
- Formats: Commander (40 life) and 20-life constructed. Free mulligan is an explicit option, default OFF.
- Battlefield: free placement plus groups (rows/columns/stacks). The old rows become a "Tidy" button.
- Saves: browser-local crash recovery plus account saves. Preferences are localStorage only.
- Quotas: 10 saves per deck, 30 per user, 10 active shares per user; 256KB per save, 128KB per share.
- Games start at **turn 0** (the opening hand); the first Next turn makes it turn 1. Partners are chosen in the start dialog.
- Simulator is a **prompt generator**, never an opponent engine. Its odds are Project Upkeep's own labelled settings.
- Tokens: search the existing `cards` catalog (`/api/cards/search?type=Token&q=...`). The deck-specific "tokens this deck
  makes" list is **deferred** (no `all_parts` data). Attractions and Planechase are deferred; the zone list is extensible.
- Deleting a deck deletes its saves and shares (cascade). A share is independent of the save it came from.

## Hard rules

- CLAUDE.md constraint 3: every query about "my" data filters on the owner explicitly (RLS is the floor). Deck checks
  filter `user_id`. Constraint 4: nothing under `src/` builds a service-role client or holds a DB credential.
  Constraint 8: **never edit an applied migration** (1 to 45). Migrations 46 and 47 are new and **NOT yet applied to
  production**: the coordinator/owner applies them after review (see "Production order" below).
- Playing never writes `deck_cards`, `card_instances`, `locations` or ownership. Playtest code may read the deck list
  (`getDeck`/`getDeckList` in `page.tsx` only). Enforced by ESLint blocks (`eslint.config.mjs`) and
  `scripts/playtest-boundary.test.ts` (the server actions may name only `playtest_sessions`, `playtest_shares` and a
  read-only `locations`, and no `.rpc(`).
- `src/lib/playtest/**` is framework-free (no react/next/supabase/@/app/@/components). `board/` and `opponent/` may not use
  `Math.random`, `Date.now` or `crypto.randomUUID`: randomness is decided before a command and carried on it.
- Server actions in `play/actions.ts` export nothing but async actions, take the deck id from the route, and the owner
  from `auth.getUser()`. The play UI receives them as props from `page.tsx`; nothing in `src/components/playtester`
  imports from `@/app/**`.
- The share payload is built by `projectPublic` from an allow-list and is never a copy of the owner snapshot.
  `scripts/playtest-share-projection.test.ts` is the leak test and has a proof that it can fail. Do not weaken it.
- `src/proxy.ts` stays as is; `NEXT_PUBLIC_*` only as literal member expressions; `AGENTS.md` is machine-written.
- Animations: CSS transforms only, off while dragging and under `prefers-reduced-motion`, and state never waits on an
  animation. Board images use `image_uri_small`; the normal image only on inspect. Keep `unoptimized`.

## Build order and status

| # | Step | Status | Commit |
|---|------|--------|--------|
| 1 | Lint fences and the actions boundary test | DONE | `d66c863` |
| 2-5 | Game core v2: types, invariants, strict serialize, v1 converter, events, format/trackers, game-start (turn 0, partners), full command set, property test, layout model and `tidyLayout` | DONE | `d8815c1` |
| 6 | `share.ts` + leak test, metrics, export, opponent generator/presets, recovery, settings, dice, palette (pure modules + tests) | DONE | `5cfd3d9` |
| 7 | Migrations 46 and 47, schema tests 27 and 28, deliberate breaks run | DONE | `dfd9f42`, `ff40728` |
| 8 | Server actions (`play/actions.ts`), read-only loaders (`play/sessions.ts`), `session.ts`/`slim.ts`, `errors.ts` mapping, boundary test reading the real files, session tests | DONE (the page wiring listed below moved into step 9 because it needs the new `PlayBoard` props) | see `git log` (commit "Playtester step 8") |
| 9 | UI and page/route wiring | DONE for implementation — first table, main UI, controls, and visual refinement. Browser fixture verified the main loop. Live database and accessibility QA remain below. | `447eeb6`, `7beac5e`, `178cc58`, `b88ed82` |
| 10 | Docs: privacy page, CLAUDE.md directory map, data-access.md, app-router.md | DONE in this docs commit | this commit |

### Step 9 implementation and verification limits

- Done: page owner check, slim entries, server SHA-256 fingerprint, saves/session loaders, bound actions; popout and signed-in share routes; sign-out local-key clearing in both nav forms.
- Done: initial start dialog (format, life, partner, first-turn draw, free mulligan); London mulligan with ordered bottom choices and inspect; board, hand, card menu, zone browser, tracker bar, palette/shortcut sheet, local recovery, basic save/share/settings/log/metrics/export/token/simulator panels.
- Browser fixture: `/?playtest-fixture=1` in development only, before the home page's auth query. No account or database needed. It is guarded by `NODE_ENV === "development"` and is absent as a reachable feature in production.
- Added in the UI refinement: token catalog search and custom extras, notes/counters/offsets/reveal/library insertion in the card menu, image-based full-hand overlay, all tracker paths, all five metric series, fingerprint mismatch choice for direct session URLs, simulator odds controls, turn feedback (the hand fan was removed in the follow-up restyle; the hand is a straight row). Remaining verification: keyboard and touch QA at 200% zoom, live token catalog verification, and account save/share testing against a migrated non-production database. The share route was compiled but not exercised against live DB/migrations. No production migration applied. ~~The optional keep-search-open-while-dragging setting is exposed but the zone overlay does not yet support dragging while open.~~ Closed in the follow-up pass below.
- Visual: the full-screen dark table uses Project Upkeep palette/typography. The browser fixture verified the hand bottom-left, three piles bottom-right, toolbar bottom, and small controls top. The battlefield fit bug and hand pointer menu dismissal bug were found in browser and fixed. The next-turn control was exercised from turn 0 to turn 1.

### Step 10 documentation
- The privacy page now describes signed-in, link-only redacted table shares, account saves, and browser-local recovery.
- `CLAUDE.md` maps the play, popout and share routes and the board/opponent library directories; its test count is 79.
- The data-access and app-router rules document owner-only saves, the authenticated share RPC, and route conventions.
- The coordinator should update BACKLOG item 24 after review; this branch does not edit `apps/mobile/docs/BACKLOG.md`.

### Follow-up pass (2026-09-25): zone overlay drag while open

- With `keepSearchOpenWhileDragging` on, the zone overlay is a docked, non-modal side sheet (`PlayBoard.tsx` `TableDialogs`, `data-docked`), and its cards can be dragged with a mouse or pen onto the battlefield, the hand or a pile (`ZoneBrowser.tsx` reuses `startHandDrag` with `fromZone`). Touch does not drag out of the overlay (a finger on a scrolling list cannot tell a drag from a scroll); the card menu (click, or Enter) has every move and is the touch and keyboard path.
- The overlay rules live in `src/components/playtester/zone-overlay.ts`: what it lists, `shouldShuffleOnClose`, `closeZoneOverlay` (the ONE function Done, X, Escape and a click outside all call) and `openDialog` (every dialog open goes through it, so opening Settings or a different search while a library search is open resolves the shuffle first; the reviewer found this gap and it is fixed and tested). It flips the dialog state to closed before it dispatches, so a second close finds nothing open: shuffle on close is resolved exactly once, however many drags happened while it was open.
- Tests: `scripts/playtest-zone-overlay.test.ts` (12). The once-only guard was falsified by removing it: two tests failed, then it was restored and all passed.
- Known limit: shuffle on close depends on the overlay having been OPENED as a library search, not on which zone the dropdown is showing when it closes.

### Follow-up pass (2026-09-25): table look, zoom, keyboard and touch

Visual: the table now follows the owner's Archidekt reference layout in Project Upkeep tokens. The table root carries the `dark` class so every token (`bg-surface-raised`, `text-ink`, `border-border`, `bg-canvas`, the WUBRG tokens) resolves to the dark palette whatever the site theme is, and `.pt-mat` (globals.css) paints the playmat colour with a faint dot grid. Top-left "Playtester actions" and "Keybinds" are plain text items; top-right is a "Full interaction log" tile with a quiet "Pop out the table" link under it; there is no frame around the battlefield except while a card is being dragged. The bottom strip is the hand (round undo and redo at each end, "Cards in hand: N", "Hand options"), then Library (N) / Graveyard (N) / Exile (N) with a menu on each header and a card-sized slot ("No cards" when empty), then a docked vertical "View other zones" tab. The toolbar is the brand mark (links back to the deck), "Game menu", icon counters (life, poison, experience, energy, W U B R G C mana), "Other trackers", "Next turn" and "More". New files: `Piles.tsx`, `icons.tsx`; `TrackerBar.tsx` rewritten. A counter is a small pill; pressing it opens its stepper in place (minus, plus, Set...), ArrowUp/ArrowDown adjust it without opening, Escape or a press elsewhere closes it. Piles are drop targets (`data-drop`), so a card can be dragged from the table, hand or zone overlay onto a pile.

Verified in the browser (development fixture, worktree dev server on port 3100; see "How to run everything" for why not the preview config):
- Drag while open: from the docked search sheet a card was dragged to the battlefield, to the graveyard pile and to the hand. The sheet stayed open, the library count fell each time, and the log showed three moves and exactly ONE "Shuffled the library." after Done.
- Keyboard: D draws; F opens the docked search with focus on its first control; Tab reaches a card in the sheet; Enter opens its menu (every move, including "Insert at library position..."); Escape closes the menu and returns focus to the card; a second Escape closes the sheet. Escape now closes any open dialog wherever focus is (it used to need focus inside the panel; a resize left focus on the page and the Log dialog could not be dismissed).
- 200% zoom (768x450 CSS pixels, fine pointer; 700x450 gives a touch emulation): the whole table fits with no scrolling, hand, piles, toolbar and Next turn all reachable. The hand cards and pile slots scale with viewport height, the bottom strip's real height is measured into `--pt-bottom` so the docked sheet never covers it, and the top-left items go side by side on short viewports.
- Phone width (375x812 mobile emulation): the bottom strip stacks (hand above piles) and the toolbar puts Next turn and More on the first row with the counters wrapping below. Nothing overlaps. The battlefield is very small on a phone by design of the fixed-shape board; that is not new.
- Found and fixed: the card menu could run off the bottom of the screen (its top was clamped against a fixed height); it now measures itself and clamps to the viewport.

Not verified: real touch input (no touch device here; the mobile emulation sends mouse clicks, and touch drags out of the overlay are deliberately not offered, the card menu is the touch path); screen-reader announcements (only the accessible names and roles were read from the tree, no assistive technology was run); high-contrast mode; light theme on the site (the table forces dark, the portalled menus follow the page theme).

### Follow-up pass 2 (2026-09-25): owner's first hands-on test

- **Hand hover flicker fixed.** Cause: a hover set `inspect` with `big: false`, and `CardInspector` drew the same full-screen modal for it. The overlay landed under the pointer, took the hover away, which dismissed it, which gave the hover back. Now only a deliberate inspect (long press, the I key, the menu) is a modal; a hover is a click-through preview (`pointer-events-none`) or feeds the details column. Second cause: the card lifted itself out from under the pointer at its bottom edge; the lift now hangs off the untransformed wrapper (`group-hover/hand`), and the old inline `zIndex` no longer beats the hover raise (`hover:z-30!`). A hovered hand card now raises and scales to 110%, from its bottom edge, with a reduced-motion variant. Checked in the browser by hovering a card's bottom edge for 2 seconds: one DOM change, no dialog.
- **Card back.** `CardArt` `faceDown` now draws the standard Magic card back from Scryfall (`CARD_BACK_URL`), with the sleeve pattern underneath as the offline fallback. This applies to the library pile, hidden hand cards and face-down permanents. The sleeve colour setting now only shows through when the image cannot load.
- **Card details column.** `CardDock.tsx`: a docked column on the right (xl and wider) that follows the hovered or focused card from the hand and the battlefield and keeps the last one. It reuses the app's own `CardDetails` via two small exports added to `CardPanel.tsx` (`useShowCardDetails`, `CardDetailsDock`), so it matches the site's sidebar. A "Card details" toggle sits top-left (setting `cardDetails`, default on, saved with the other table preferences and listed in Settings). Below xl, or with it off, a small floating preview shows instead. A card the catalogue cannot look up (custom token, the development fixture, no provider) falls back to the table's own picture, type line and oracle text. NOT yet exercised against the real provider with a signed-in account: only the fallback path was seen in the browser.
- Tests: `scripts/playtest-settings.test.ts` (2). The hover fix itself is a component behaviour and was verified in the browser, not in a unit test.

### Follow-up pass 3 (2026-09-25): owner's second hands-on round

- **Layout.** The card-details column is now full height on the right; the top bar, battlefield, hand, piles and toolbar all sit in the column beside it (`PlayBoard.tsx`: root is a row, left column and `CardDock`). Dialogs, the card menu and the inspector stay at the root so they cover everything.
- **Undo and redo** moved out of the hand row into the top bar (`UndoRedo.tsx`), fixed in place.
- **Play area.** The battlefield is a visible framed zone (the frame lights up while dragging) and the WHOLE battlefield area is the drop target (`data-drop` moved from the board to its wrapper; a drop outside the board clamps to the nearest edge). Cards are free-placed and may overlap.
- **Card size.** Hand cards are bigger (`card-size.ts`: 5.2 / 6.6 / 8 rem) and table cards are drawn at the SAME pixel width as a hand card times the table-size setting, never larger than their layout size. To make that work the layout constants changed: `CARD_W` 0.07 to 0.115, `BOARD_ASPECT` 16:9 to 2:1, and the group step constants were scaled with them. Positions are still proportions of the board, so nothing about saved shape changed, but a position saved earlier means a slightly different place on the wider board (no saves exist in production yet).
- **Hover.** A table card grows to 114% and rises on hover (its wrapper takes the hover so the card never moves out from under the pointer); the mulligan cards lift and grow (110%, 12px). Note: Tailwind v4 draws these with the `scale` and `translate` CSS properties, not `transform`.
- **Hotkeys act on the hovered card** with no click first (`targets.ts`): hover a permanent and press T to tap it. Table actions take a hovered permanent only; zone moves also take a hovered hand card; otherwise the selection. Verified: hovering a table card and pressing T turned it sideways.
- **Mana pips** in the toolbar are the real Scryfall symbols (`ManaSymbol`).
- **Other zones** (`OtherZones.tsx`, dialog `zones`): only the command zone (one card space per commander) and the sideboard (a space, and a list of its cards underneath). The temporary zone is no longer offered in the card menu or the zone picker (it is still in the model, and shows in the picker only if a card is in it).
- **Library pile**: a click draws a card; holding shows the card back large with the card count for as long as it is held (it deliberately does NOT reveal the top card; say if that is what was meant); right-click opens the same menu as the header's three dots. Graveyard and exile: click views, right-click opens the menu. Keyboard: Enter draws.
- Tests: `scripts/playtest-table-targets.test.ts` (8). Not unit-tested, browser-verified only: hover growth, the mulligan hover, the library click, hold and right-click, the Other zones panel. Not verified: touch (hold uses pointer events and should work, not tried), and the toolbar's exact wrapping at every width (it needs about 1540px in one row with the details column open).

### Follow-up pass 4 (2026-09-25): opening hand, recovery prompt, missing piles in Safari

- **Opening hand** rebuilt: seven equal-size cards fanned out (slight rotation and overlap), no captions, no Inspect button; a hover lifts and grows the card (125%) from an untransformed wrapper; click chooses a bottom card (numbered badge). Keep hand and Mulligan now sit ABOVE the fan, and the line under the title says how many more bottom cards to choose. The owner reported "Keep hand doesn't click": it was disabled until the required London bottoms were chosen, and the buttons had been pushed off screen by a wrapped second row. Verified in the browser: disabled at first, enabled after two picks, click proceeds.
- **Recovery prompt** ("Continue your last game?") is no longer a native dialog in the top-left corner; it is a small box centred above the Start box (`hooks/useRecovery.tsx`).
- **Piles vanished for the owner in Safari** (they render in the Chromium browser pane at 1333x650, 1400x800 and 1500x900, so this was not reproduced). Suspected cause: the pile width was one long `min()/max()` expression on an element that also had `container-type: inline-size`; if a browser drops that declaration the element's width becomes 0, and a contained element with no width collapses. Fixed defensively: `.pt-pile` in globals.css declares a plain fallback width first and the fitted one second, the container queries are gone (viewport media queries instead), the piles-and-tab wrapper cannot shrink, and the hand card cap uses `vh` rather than `dvh`. NOT confirmed in Safari (no Safari or WebKit here): the owner needs to reload and report; if the piles are still missing, get the Safari version and the console.
- **No frame; the whole mat is the table.** The battlefield box is gone and the board now FILLS the play area (`useSize`, not a fixed-shape fit), so a card can be dropped anywhere on the dotted background; the empty-table text stays, lighter and thinner. Because the board is no longer 2:1, a stored position can leave a card hanging off a short, wide board, so a table card's drawn position is clamped onto the mat in CSS (`cqw` units, `BattlefieldCard.tsx`); the core's own clamp still assumes 2:1 (`BOARD_ASPECT`), which is now only the fallback aspect for keyboard nudges. Checked in the browser: cards dropped at the far top-left (0,0) and bottom-right were both fully on the mat, drawn at the hand card's width. Not checked: very short windows with many rows, and group and tidy layouts on a board that is not 2:1 (steps are fractions of the board, so they stretch with it).
- The "N selected" badge moved below the three top-left items (it overlapped "Card details").
- The details column being absent in the owner's screenshot most likely means the "Card details" toggle was off (it is saved per browser); it is on by default.

### Follow-up pass 5 (2026-09-25): toolbar, zones, mulligan

- **Mulligan buttons** are one size, and there is a **Free mulligan** button: new `free` flag on the `MULLIGAN` command; it reshuffles and deals seven again WITHOUT counting, so it adds no card to put on the bottom and can be pressed as often as wanted (`playtest-board-mulligan.test.ts`, 12 tests). The start dialog's "first mulligan free" option is unchanged.
- **Full interaction log** moved to the top-left stack in the same plain style; the "Pop out the table" link is removed from the UI (the `/decks/[id]/play/popout` route and `PopoutBridge` still exist, unlinked).
- **No pop-ups for moves.** The "Rearranged 1 card on the table / Undo" toast is no longer drawn; the text is still announced through a visually hidden `role="status"` region, and undo is the top-bar button. The store still produces toasts; only their display went.
- **Hover preview** (used when the details column is off or the window is under xl) now sits in the top-right corner. With the column on, the column's own image is the top-right image.
- **Zones** keep their size and place when the window narrows horizontally (`.pt-pile` no longer shrinks with width until under about 480px, where 22vw takes over so three piles still leave the hand some room), and the hand overlaps more and more instead (capped so a strip of each card always shows). The phone stacking of the bottom strip was removed. Piles are bottom-aligned with the hand cards (both use the same bottom padding; the hand section is a column so its cards sit at the bottom).
- **Bottom bar is always one row** (`TrackerBar.tsx` rewritten; it measures itself): brand mark, Game menu, life with a minus and a plus, the mana pool, then status, Next turn, More. Under 900px the six mana counters fold into one Mana button that opens them in a panel above the bar; under 640px the words go and icons stay; the save status hides under 1100px. **Right-click on life** (or the context-menu key; on a touch screen a small dots button) opens the other trackers: poison, experience, energy, life 2, damage and commander damage. Poison, experience and energy are therefore no longer on the bar itself. Checked in the browser at 1500, 820 and 600px wide: one row each time, mana collapsed at 820, right-click on life opens the panel.
- Not verified: the hover preview position (CSS only), the panel behaviours on a touch screen, and Safari.

### Follow-up pass 6 (2026-09-25): toolbar on top, one card size, recovery in the Start dialog

- **Toolbar moved to the TOP** (`TrackerBar.tsx`, now `border-b`, panels open downward) with undo and redo in it after the Game menu, and the turn number beside Next turn. The top-left items (Playtester actions, Keybinds, Full interaction log, Card details) sit directly underneath it as an overlay ON the mat, so the play area starts right under the bar and a card can be placed at the very top. The old top row and `UndoRedo` placement in it are gone.
- **One card size** for the hand, the three piles and the command slot: the table root sets `--pt-card` (the hand card width from `handCardPx`, capped by window height) and all of them use it. Verified by measurement: the hand card and all three piles are 106 by 148 with the same top edge (so they are bottom-aligned). The earlier `.pt-pile` rules are gone.
- **No card title under a table card**: the label is removed and the `showLabels` setting with it (the settings test now uses another boolean). **No yellow drop outline** on the battlefield (`DropBadge` deleted).
- **Life**: the heart is now a soft, translucent shape BEHIND the number, so it takes no width of its own.
- **Recovery question** ("Continue your last game?") now lives INSIDE the Start dialog's overlay, above the Start box (state in `ui.recovery`, the answer in `ui.recoveryChoice`, acted on by `RecoveryManager`), so it can no longer end up on a different layer from the dialog; it clears when any new game starts.
- **Drag from Other zones**: the command zone card and each sideboard row can be pressed and dragged to the table (or a pile or the hand); the Other zones panel fades out while a card is in flight and closes once a card has left. Verified with synthetic pointer events on a sideboard card (the fixture has no commander, so the command slot shares the code but was not exercised by itself).
- **Opening hand cards not showing (owner's screenshot)**: NOT reproduced; in the Chromium pane the fan renders (7 cards, 193 by 246, equal size) after a mulligan and a free mulligan. The fan now uses plain inline sizing (no `clamp()` or generated padding classes) in case that was the difference. If it is still missing, the owner needs to hard-reload (the dev server's hot-reload socket was failing in this pane, and may in Safari too) and report the Safari version.
- Not verified: Safari, touch, the details column with a real signed-in deck, and screenshots this round (the browser pane was hidden, so checks were by DOM measurement).

## Migrations and the production order (nothing has been applied to production)

Files: `supabase/migrations/00000000000046_playtest_sessions.sql`, `00000000000047_playtest_shares.sql`.
Schema tests: sections 27 (sessions) and 28 (shares) at the end of `supabase/tests/schema_test.sql`; each header records
the deliberate break that was run for every assertion and which assertion it tripped. The one honest caveat: 27(e)'s
delete assertion is guarded twice (select AND delete policies), so it was falsified by loosening both.

Production order for the coordinator/owner, in this order:
1. Review the diff with the `reviewer` agent.
2. `npx supabase migration list --linked` to confirm 1 to 45 are applied and 46/47 are not.
3. `npx supabase db push --linked` to apply 46 then 47 (they are additive; nothing existing changes).
4. Only then merge the code. The code that reads these tables must never land before the migrations
   (`sessions.ts` degrades to "saving unavailable" on a missing table as a seatbelt, not as the plan).
5. `npm run check:migrations` should then be clean. After first real use, check `pg_column_size` of a few snapshots.

## How to run everything

```bash
npm run lint && npm run typecheck && npm test      # all three, every time
npm run build
npm run test:db                                     # only when the schema changes
```

- `npm run typecheck` shows 4 pre-existing errors in `scripts/sync-oracle-*.ts` in this checkout only (the main checkout's
  `node_modules` lacks the `postgres` package). They are not part of this work; ignore them. Everything else must be clean.
- `npm test` is `tsx --test scripts/*.test.ts`. Playtest tests are `scripts/playtest-*.test.ts` (283 tests at step 6).
  The property test runs 40 seeded hostile sequences; bump the seed count temporarily to hunt (it passed 400).
- `test:db` needs PostgreSQL 16 (15+ required for `security_invoker` views). The recipe that worked:

```bash
export LC_ALL=C LANG=C
/opt/homebrew/opt/postgresql@16/bin/initdb -D <scratch>/pgdata -U postgres --auth=trust
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D <scratch>/pgdata -o "-p 55433 -c listen_addresses=localhost -c unix_socket_directories=''" -l <scratch>/pg.log start
export PATH=/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/bin:/bin
export PGHOST=localhost PGPORT=55433 PGUSER=postgres DBNAME=mtg_verify_playtest   # a scratch name so sessions do not collide
./scripts/verify-migrations.sh
```

  Short socket path matters only for unix sockets, which the `unix_socket_directories=''` flag avoids. Stop the cluster when
  finished: `pg_ctl -D <scratch>/pgdata stop`. Do not point `test:db` at anything but a throwaway database.
- Dev server: NOTE the preview tool runs `.claude/launch.json` from the MAIN checkout, so in a worktree it serves the main branch (no fixture route). In this pass the worktree's own server was started with `npm run dev -- --port 3100` and opened with the browser's `navigate`. Otherwise: `mcp__Claude_Browser__preview_start` with config name `dev` (`.claude/launch.json`, `npm run dev`, port 3000,
  auto port). Signing in as a real user is not possible in the sandbox (the `.env.local` points at production Supabase):
  do NOT create accounts or enter credentials. Exercise the board through the fixture/harness route (see step 9 item 9;
  not written yet).

## Gotchas already hit

- **ESLint flat config replaces, it does not merge.** A later block that sets `no-restricted-imports` or
  `no-restricted-syntax` for a file REPLACES the earlier setting. Every playtest block in `eslint.config.mjs` re-spreads
  `DB_DRIVERS` and `SCRYFALL_SYNTAX`. The core rule cannot allow type-only imports, so the playtest blocks turn it off and
  use `@typescript-eslint/no-restricted-imports` with `allowTypeImports`.
- **Never put `[id]` in a lint glob**: gitignore-style brackets are a character set. The globs use `decks/*/play/**`.
- The old analyzer files in `src/lib/playtest/` (`library.ts`, `mana.ts`, ...) import collection code at runtime, so the
  collection ban is scoped to `board/`, `opponent/`, `game-start.ts` and `recovery.ts`, not the whole folder.
- `"constructor" in {}` is true and `obj["__proto__"] = x` rewrites the prototype. Every keyed lookup in the core uses
  `has`/`own`/`safeKey` (`board/reducers/util.ts`); `serialize.ts` refuses `__proto__` as a key. The property test found
  two unclamped-position bugs and this class of bug; keep the generator hostile.
- Reducers return the SAME state reference when nothing changed. The store depends on that to avoid empty undo steps.
- Schema test file: sections are separate `begin; ... rollback;` blocks, so fixtures do not carry over. Numbering is not
  monotonic in the file (there are two "14"s); 27 and 28 are appended after 26. Use `pg_temp` helper functions that return
  SQLSTATE strings, not raw exceptions.
- CHECK constraints pass on NULL. The version/fingerprint matches use `is not distinct from` for that reason.
- RLS `WITH CHECK` runs after BEFORE triggers, and DELETE/UPDATE need the SELECT policy too.
- The "use server" file may export only async functions. Bound arguments (`action.bind(null, deckId)`) are encrypted by Next.
- A worktree-isolated shell refuses some compound commands; keep bash calls simple and use literal paths.

## Verified vs unverified (as of the follow-up pass, 2026-09-25)

Verified by running it:
- `npm run lint && npm run typecheck && npm test`: 0 errors (5 existing `apps/mobile` hook warnings), typecheck clean, **931 tests pass** (81 files, 28 of them playtest). `npm run build` (the standard Turbopack build) **passes** in this pass: fonts could be fetched this time, so the font-mock workaround below was not needed. The routes `/decks/[id]/play`, `/decks/[id]/play/popout` and `/shared/playtest/[token]` all compile.
- Scratch database: `./scripts/verify-migrations.sh` applied migrations 1 to 47 to a fresh PostgreSQL 16.15 and `schema_test.sql` (including sections 27 and 28) passed. Then `scripts/playtest-db-contract.ts` (new) fed the app's REAL output through those tables: a save built by `prepareSave` from a played Commander game was inserted as the owner and read back byte-for-byte equal; two shares built by `projectPublic` (hand hidden, hand shown) were inserted; a second signed-in user read each through `get_playtest_share` and got only `title`, `projection`, `updatedAt`, `expiresAt`, with no owner or deck id, no private note and no arbitrary image host; that second user saw none of the first user's saves or share rows. On the TypeScript side the canonical snapshot passed `validateSnapshot` and both projections passed `readProjection`. The assertions were shown to fail (one pointed at text that is in the payload tripped). The contract SQL is a transaction that rolls back. Run it on a throwaway database only:
  `npx tsx scripts/playtest-db-contract.ts | psql -v ON_ERROR_STOP=1 -h localhost -p <port> -U postgres <scratch db>`.
- Token search: `scripts/playtest-token-search.test.ts` shows `/api/cards/search?type=Token&q=...` takes the advanced (direct `cards` query) branch with type and name intact, and that hostile text is carried as data.
- Browser fixture: everything listed under the follow-up pass sections above, plus the earlier start, mulligan, recovery, hand menu, library browser and Next turn checks.

NOT verified (say so honestly in any report):
- The server actions and pages talking to a real Supabase project (auth cookies, PostgREST, the `.rpc` call from `shared/playtest/[token]/page.tsx`). The scratch database has the schema and the row security but no Supabase auth or API layer, and this environment's `.env.local` points at production, so no account was created or used. The contract check covers the SQL boundary, not the Next server boundary.
- Token search against the live catalogue: whether the `cards` table returns token rows for `type_line ilike %Token%` with `digital = false` was not run. Only the request shape was tested.
- Real touch input and assistive technology (screen reader), high-contrast mode, and a real 200% browser zoom on a physical display (checked with viewport emulation at 768x450 and 700x450).
- Scryfall's rules on hot-linking card images in shared tables (the projection only keeps `https://cards.scryfall.io/...` URLs; the owner should confirm).
- Production behaviour of migrations 46/47: not applied. Nothing was applied to production.
- The `reviewer` agent has not reviewed this branch; the handoff requires it before merge.

The earlier offline-build note: when Google Fonts cannot be fetched, `NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/tmp/playtest-font-mock.js npx next build --webpack` passed with local font fixtures in the previous session; Turbopack with the mock failed resolving its internal font CSS module.

## Prompt to paste into the next tool

> You are resuming a half-built feature in the Project Upkeep repo. Read `PLAYTESTER_BUILD_HANDOFF.md` first, then
> `ARCHIDEKT_PLAYTESTER_DEVELOPMENT_GUIDE.md`, `PLAYTESTER_ARCHITECT_MAP.md` and `CLAUDE.md` (and the rule files it points
> to). Check out the branch `feat/playtester-archidekt-parity`. Continue from the first step in the handoff's build-order
> table that is not DONE, in that order, committing after each step and updating the handoff in the same commit. Do not push,
> open a PR, apply any migration, or edit `apps/mobile/docs/BACKLOG.md`. Follow the hard rules in the handoff exactly. Before
> you stop for any reason, run `npm run lint && npm run typecheck && npm test` (plus `npm run test:db` if the schema changed
> and `npm run build`), commit, and end with a report of what is built, what is verified, and what is not.
