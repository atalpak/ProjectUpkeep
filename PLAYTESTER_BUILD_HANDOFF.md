# Playtester build handoff

Written so a fresh AI tool with **no memory of the conversation that started this** can pick the build up and finish it.
Keep this file truthful: update the checklist and the "what remains" section in the same commit as the work.

Last updated: 2026-09-25, after step 7 and while step 8 is in progress.

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
- The worktree has no `node_modules` of its own: it is a symlink to the main checkout's
  (`ln -s /Users/anthonytalpak/ProjectUpkeep/node_modules node_modules`). It is untracked, so **never `git add -A`**;
  add paths explicitly.
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
| 9 | UI and the page/route wiring (see below) | IN PROGRESS — WIP checkpoint commit; the tree does NOT typecheck/build yet (old PlayBoard/ZonePile/CardMenu/etc. were deleted; the new `PlayBoard` and `page.tsx` wiring are not written). Started so far under `src/components/playtester/`: `store.ts`, `ui-store.ts`, `context.tsx`, `board-actions.ts`, `drag.ts`, `hooks/`, `CardArt.tsx`, `BattlefieldCard.tsx`, `Battlefield.tsx`, `GroupFrame.tsx`, `Hand.tsx`; plus `src/lib/playtest/{catalog,hand}.ts` and edits to `session.ts`, `settings.ts`, `slim.ts`, `sessions.ts`, `globals.css`. Still to write: `PlayBoard` (thin shell + toolbar/layout per the reference), `StartDialog`, `OpeningHand`, `HandOverlay`, `Marquee`, zone piles + `ZoneBrowser`, one shared `CardMenu`, `CardInspector`, `TrackerBar`, `DiceMenu`, `LogPanel`, `MetricsPanel`, `ExportDialog`, `SessionList`/`SaveDialog`, `ShareDialog`, `SettingsDialog`, `ShortcutSheet`/command palette, `InteractionPanel`, `PublicBoard`, `PopoutBridge`, the `page.tsx` wiring, `popout/page.tsx`, `(app)/shared/playtest/[token]/page.tsx`, animations, recovery UI | see `git log` (WIP checkpoint) |
| 10 | Docs: privacy page, CLAUDE.md directory map, data-access.md, app-router.md | TODO | |

### Step 8 leftovers (do these at the start of step 9, they need the new `PlayBoard` props)
- Rewrite `src/app/(app)/decks/[id]/play/page.tsx`: `getDeck`, `getDeckList`, slim the entries (`slimEntry`), compute the
  deck fingerprint on the SERVER (`fingerprintText` then node `crypto` SHA-256, commander = `deck.commander_card_id`),
  `getCurrentUser()` for the local-storage namespace, `loadSaves`, and `loadSession` for `?session=<id>`. Pass the bound
  actions (`saveSession.bind(null, id)` and so on) to `PlayBoard` as props. Add `popout/page.tsx`.
- `createGameStart` now takes `StartEntry[]` (from `slim.ts`) semantically; today its type is still `DeckListEntry[]`
  (a `DeckListEntry` is assignable to `StartEntry`). Switch the parameter type to `StartEntry` when wiring the page.
- Add `src/app/(app)/shared/playtest/[token]/page.tsx` (signed-in only, inside the `(app)` group, `force-dynamic`,
  `robots` noindex,nofollow, `referrer` no-referrer, calls `supabase.rpc("get_playtest_share", { p_token })`, validates
  with `readProjection`, renders `PublicBoard`, shows the Fan Content Policy notice) and clear `upkeep:playtest:` keys in
  the sign-out form in `src/components/AppNav.tsx` before submitting (`allPlaytestKeys` in `recovery.ts`).

### Step 9, what remains (the whole UI; nothing of it is written yet)
The existing components in `src/components/playtester/` (`PlayBoard`, `Battlefield`, `Hand`, `ZonePile`, `GameCard`,
`CardMenu`, `GameControls`, `ActionLog`, `TokenForm`) still target the **v1** state and do not compile against v2. Replace
them; do not patch them. Order (from the map): store first, then the rest.
1. `store.ts` (`useSyncExternalStore`): state, history (`board/history.ts`), selection, a **stable** `dispatch` that stamps
   `ts` and skips the undo entry when `applyCommand` returns the same reference (and for `PEEK`); `useCard(id)`
   per-card subscriptions. `PlayBoard` becomes a thin shell. One shared `CardMenu` anchored to the selected card;
   `BattlefieldCard` memoised so tapping one card does not rerender 100.
2. Free-placement `Battlefield` on the proportional board (`layout.ts` constants; 16:9 virtual board scaled to fit):
   pointer events with pointer capture, drag via a ref + `requestAnimationFrame` with no store updates, ONE `SET_LAYOUT`
   on drop (with `order` to bring to front); snap/alignment guides (`snapPosition`); `Marquee` box select (`cardsInRect`);
   `GroupFrame`; keyboard nudges merged into one undo step (~500ms); screen-reader order via `readingOrder`.
3. Hand row (fan, undo/redo round buttons at each end, "Cards in hand: N", "Hand options": sort, random discard, hide, move
   all, full-hand overlay `HandOverlay`), zone piles with counts and "No cards" placeholders (library pile visibly shrinks),
   docked "View other zones" tab, `ZoneBrowser` (search/peek, shuffle-on-close resolved once), `StartDialog` (format,
   partners, free mulligan, first-turn draw), `OpeningHand` (staggered fan, London bottoming controls for keyboard and touch,
   mulligan sweep), `CardInspector` (hold-key/long-press full card; oracle text from the entries else `/api/cards/[id]`).
4. `TrackerBar` (game menu, life with count animation and red/green flash, poison/experience/energy, mana pool, Next turn,
   More), `DiceMenu` (roll with `rollResult`, send `ROLL`), turn banner (also the upkeep reminder slot), undo toast chip
   after every action, floating selected count and total power/toughness (`selectionTotals`), drop-target highlights
   ("Graveyard", "Top of library"), Tidy button (`tidyLayout`), card-shaped image placeholders so the board never jumps.
5. Command palette on `/` and Ctrl/Cmd-K plus `ShortcutSheet`, both driven by `palette.ts` (`matchPalette`,
   `resolveShortcut`); shortcuts never fire while a text field is focused.
6. Recovery (`hooks/`): localStorage via `recovery.ts` (read only after mount; write 1s after the last change, at most 5s
   while changing, and on `visibilitychange` hidden / `pagehide`; catch every storage error; banner "Crash recovery is off in
   this browser..."; restore prompt "Continue your game from N minutes ago?"; autosave indicator "Saved locally" + time with a
   plain failure warning; delete keys belonging to another user id on load).
7. `SessionList`/`SaveDialog` (save, overwrite with conflict handling, save as, rename, duplicate, restore with a dirty
   confirmation, delete; fingerprint mismatch offers "Continue saved state" / "Start with current deck"), `SettingsDialog`
   (`settings.ts`), `LogPanel` (turn-grouped, void an entry with the "log no longer matches" warning), `MetricsPanel`
   (plain SVG, no chart library, prints `CONVENTIONS`), `ExportDialog` (`compactLog`, `fullLogJson`, copy and download),
   `ShareDialog` (create / update / stop sharing, show-hand toggle), `PublicBoard` (read-only, shared by the share page and
   the pop-out), `PopoutBridge` (BroadcastChannel, same browser), `InteractionPanel` (opponent prompts: Next turn records a
   pending prompt via `generateInteraction`, then ignore / resolve manually / reroll, then `NEXT_TURN`).
8. Accessibility: every drag has a menu and a keyboard equivalent, focus returns predictably, card images have alt text,
   counters and tap state are announced as text, touch targets 44px under the `coarse:` variant.
9. A dev-only fixture/harness route so the board can be exercised without auth or a database (delete it or keep it strictly
   dev-guarded, and say which in the report).

### Step 10, what remains
- `src/app/privacy/page.tsx`: it says data is never shared with anyone outside the app. That stops being true once a user
  publishes a share (signed-in readers holding the link can see a redacted table). Update it in this branch.
- `CLAUDE.md` directory map: add `src/lib/playtest/board/` (and `opponent/`, `recovery.ts`, `game-start.ts`), the `shared/`
  route, `play/`, and update the test-file count.
- `.claude/rules/data-access.md`: the authenticated-only `get_playtest_share` function and that playtest tables are
  owner-only with no friend policy. `.claude/rules/app-router.md`: the shared-table page and the play route conventions.
- Report the BACKLOG item 24 update for the coordinator; do not edit `BACKLOG.md`.

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
- Dev server: `mcp__Claude_Browser__preview_start` with config name `dev` (`.claude/launch.json`, `npm run dev`, port 3000,
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

## Verified vs unverified (as of this update)

Verified by running it: lint, the full unit suite (playtest tests), the property test, migrations 46/47 and schema tests
27/28 against a scratch PostgreSQL 16 (every assertion falsified, see the test headers), the share leak test failing when
`library` is added to the projection.

NOT verified yet: anything in a browser (the UI does not exist yet); `npm run build`; token search against the live
catalog (`/api/cards/search?type=Token` is read from code, not exercised); Scryfall's rules on hot-linking card images in
shared tables (the projection only ever keeps `https://cards.scryfall.io/...` URLs; the owner should confirm); real
production behaviour of migrations 46/47 (not applied).

## Prompt to paste into the next tool

> You are resuming a half-built feature in the Project Upkeep repo. Read `PLAYTESTER_BUILD_HANDOFF.md` first, then
> `ARCHIDEKT_PLAYTESTER_DEVELOPMENT_GUIDE.md`, `PLAYTESTER_ARCHITECT_MAP.md` and `CLAUDE.md` (and the rule files it points
> to). Check out the branch `feat/playtester-archidekt-parity`. Continue from the first step in the handoff's build-order
> table that is not DONE, in that order, committing after each step and updating the handoff in the same commit. Do not push,
> open a PR, apply any migration, or edit `apps/mobile/docs/BACKLOG.md`. Follow the hard rules in the handoff exactly. Before
> you stop for any reason, run `npm run lint && npm run typecheck && npm test` (plus `npm run test:db` if the schema changed
> and `npm run build`), commit, and end with a report of what is built, what is verified, and what is not.
