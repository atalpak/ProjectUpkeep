# Playtester build handoff

Written so a fresh AI tool with **no memory of the conversation that started this** can pick the build up and finish it.
Keep this file truthful: update the checklist and the "what remains" section in the same commit as the work.

Last updated: 2026-09-25, after UI and documentation implementation.

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
- Added in the UI refinement: token catalog search and custom extras, notes/counters/offsets/reveal/library insertion in the card menu, image-based full-hand overlay, all tracker paths, all five metric series, fingerprint mismatch choice for direct session URLs, simulator odds controls, hand fan and turn feedback. Remaining verification: keyboard and touch QA at 200% zoom, live token catalog verification, and account save/share testing against a migrated non-production database. The share route was compiled but not exercised against live DB/migrations. No production migration applied. The optional keep-search-open-while-dragging setting is exposed but the zone overlay does not yet support dragging while open; treat it as a known P1 interaction gap.
- Visual: the full-screen dark table uses Project Upkeep palette/typography. The browser fixture verified the hand bottom-left, three piles bottom-right, toolbar bottom, and small controls top. The battlefield fit bug and hand pointer menu dismissal bug were found in browser and fixed. The next-turn control was exercised from turn 0 to turn 1.

### Step 10 documentation
- The privacy page now describes signed-in, link-only redacted table shares, account saves, and browser-local recovery.
- `CLAUDE.md` maps the play, popout and share routes and the board/opponent library directories; its test count is 79.
- The data-access and app-router rules document owner-only saves, the authenticated share RPC, and route conventions.
- The coordinator should update BACKLOG item 24 after review; this branch does not edit `apps/mobile/docs/BACKLOG.md`.

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

Verified by running it after step 10: `npm run lint && npm run typecheck && npm test` passed (919 tests, 5 existing
`apps/mobile` hook warnings, no errors). Migrations 46/47 and schema tests 27/28 previously passed against a scratch
PostgreSQL 16 (every assertion falsified, see the test headers); the share leak test failed as designed when `library`
was added to the projection. No schema file changed in steps 9–10, so `npm run test:db` was not rerun.

Verified in a browser through the dev-only fixture: start, mulligan/bottom/keep, local recovery, playing a card via
keyboard menu, pointer hand menu, library browser, and Next turn from 0 to 1. The standard `npm run build` could not
fetch Google Fonts in this offline environment. `NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/tmp/playtest-font-mock.js npx next
build --webpack` passed, including the play, popout, and share routes. Turbopack with the font mock failed resolving
its internal font CSS module. NOT verified yet: live account saves/shares or DB-backed pages; token search against the
live catalog (`/api/cards/search?type=Token` is read from code, not exercised); 200% zoom/touch/accessibility pass;
Scryfall's rules on hot-linking card images in shared tables (the projection only keeps
`https://cards.scryfall.io/...` URLs; the owner should confirm); real production behaviour of migrations 46/47 (not
applied).

## Prompt to paste into the next tool

> You are resuming a half-built feature in the Project Upkeep repo. Read `PLAYTESTER_BUILD_HANDOFF.md` first, then
> `ARCHIDEKT_PLAYTESTER_DEVELOPMENT_GUIDE.md`, `PLAYTESTER_ARCHITECT_MAP.md` and `CLAUDE.md` (and the rule files it points
> to). Check out the branch `feat/playtester-archidekt-parity`. Continue from the first step in the handoff's build-order
> table that is not DONE, in that order, committing after each step and updating the handoff in the same commit. Do not push,
> open a PR, apply any migration, or edit `apps/mobile/docs/BACKLOG.md`. Follow the hard rules in the handoff exactly. Before
> you stop for any reason, run `npm run lint && npm run typecheck && npm test` (plus `npm run test:db` if the schema changed
> and `npm run build`), commit, and end with a report of what is built, what is verified, and what is not.
