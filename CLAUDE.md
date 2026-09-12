# Project Upkeep

A Magic: The Gathering collection manager whose one differentiating idea is
**physical location**: which binder, which box, which deck each copy actually
sits in. The product question it answers is *"where is this card, among the
people I know?"* Trading is the second half of that, not a separate feature.

Deliberately **not** in scope: a marketplace, a valuation engine, a deck editor.
Prices are a display-only Scryfall estimate. These are decisions, not gaps.

> **Agent roster, delegation and escalation rules live in
> [`.claude/ORGANIZATION.md`](.claude/ORGANIZATION.md).** Nothing about how the
> team operates belongs in this file.

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js **16.3.3**, App Router, React 19.2 |
| Language | TypeScript 5.9, strict |
| Styling | Tailwind **v4** (`@tailwindcss/postcss`, no `tailwind.config`) |
| Database / auth | Supabase — Postgres + Supabase Auth, RLS everywhere |
| Card data | Scryfall bulk export, no API key |
| Hosting | Vercel free tier; CI on GitHub Actions, node 22 |

`package.json` requires node >=20.9.

---

## Directory map

Verified against the tree on 2026-09-09. Keep it that way — a stale map sends
agents hunting in the wrong place, which is how the previous one failed.

```
src/
  proxy.ts                  session refresh + private-route gate (see below)
  app/
    (app)/                  signed-in pages; the route group provides the nav shell
      collection/           collection view · add/ · import/
      locations/            containers
      decks/                decks-as-locations · [id]/ · check/ · import/
      find/                 "where is my card?"
      dashboard/            stats and anything awaiting a decision
      friends/  wants/  notifications/  settings/
      u/[username]/         public profile + tradable binder
    api/
      cards/                search/ · printings/ · [id]/
      collection/           export/ · locate/
      card-actions/  notifications/
    auth/confirm/  login/  signup/
    terms/  privacy/         public legal pages — outside (app), no proxy gate
    layout.tsx  page.tsx  globals.css  icon.svg  opengraph-image.tsx
  components/
    ui.tsx                  shared primitives — buttons, etc. Restyle here.
    collection/  decks/  settings/  social/  ManaCost.tsx  SetSymbol.tsx  …
  lib/
    cx.ts                   class-name joiner; own module to avoid a cycle
    env.ts                  environment access with loud failures — READ THIS
    types.ts
    scryfall.ts             Scryfall → `cards` field mapping, incl. every price
                            column. Second-largest piece of logic in the app.
    scryfall-stream.ts      streams the bulk export instead of buffering 500MB
    scryfall-upsert.ts      batched upsert with adaptive batch halving
    auth/redirect.ts        open-redirect guard for the post-login bounce
    collection/             availability · breakdown · deck-state · deck-stats
                            deck-view · entries · export · filters · list-check
                            locate · pricing · queries · stacking
    import/                 parse · resolve · plan · deck-plan · select
                            commit · name-variants · vocabulary
    social/                 queries · counter · trade-status · wants
                            notifications · tos · types
    supabase/               client · server · session · errors
supabase/
  migrations/               32 files, numbered, applied in order
  tests/schema_test.sql     assertions the schema must keep satisfying
scripts/
  sync-scryfall.ts          the scheduled sync job
  verify-migrations.sh      migrations against a throwaway Postgres
  *.test.ts                 43 unit-test files over the pure logic in src/lib
```

## Data model in one paragraph

`cards` is Scryfall's data, one row per printing, read-only to users.
`card_instances` are the copies a user owns — condition, finish, language,
quantity, location. `locations` are containers, nestable **one level deep**. A
deck is just a location type, so a card sleeved into one stops counting as
available. **`location_id = null` means "unsorted" — a real, expected state, not
missing data.** Socially: `friendships` are the trade circle, `trades` /
`trade_items` model a proposal in both directions, `ownership_history` is the
append-only transfer record, `want_list` and `notifications` drive matching and
alerts. Each migration header carries the reasoning for its decision.

---

## Hard constraints — breaking these breaks production

1. **`src/proxy.ts` is correct.** Next 16 renamed the `middleware` convention to
   `proxy`. Do not "fix" it back to `middleware.ts`.

2. **`NEXT_PUBLIC_*` must be read as literal member expressions** —
   `process.env.NEXT_PUBLIC_SUPABASE_URL`, never `process.env[name]`. Next only
   inlines the static form into the Edge and browser bundles; the dynamic form
   yields `undefined` in production and crashes the proxy on every request.
   **CI greps the built output for this and fails the build if it regresses**
   (`.github/workflows/ci.yml`). See `src/lib/env.ts` — as of 2026-09-09 there is
   no dynamic `process.env[name]` *access* anywhere in `src/` (the pattern appears
   once more, named in a comment as the thing to avoid), and the `required(name)`
   helper that used to do one was removed with its only caller. Keep it that way:
   the rule reads as absolute because it now is.

3. **RLS is the floor, not the whole filter — own-collection queries must scope
   by owner explicitly.** This constraint said the opposite until 2026-09-09,
   and the code has been right and the rule wrong since migration 9. That
   migration made a friend's *tradable* binder readable through RLS on purpose,
   so the profile page can show it. From that point on an unscoped `select` over
   `locations` / `card_instances` returns a friend's trade binder alongside your
   own. So every query in `src/lib/collection/queries.ts` that answers "what do
   *I* own" carries `.eq('owner_user_id', …)`, roughly 25 of them, and **removing
   one is a cross-user data leak, not a cleanup.** A query that deliberately
   reads across people — the public binder, want matching — says so in a comment.

4. **Nothing under `src/` may construct a service-role client.** The service key
   is read in exactly one place, `scripts/sync-scryfall.ts`, which is not part of
   the Next build and so cannot reach a browser bundle. That containment *is* the
   guard. There used to be a `src/lib/supabase/admin.ts` said to be protected by
   a `server-only` import; it had no importers, and it could never have had any —
   `server-only` throws unconditionally outside a React Server Component, so a
   `tsx` script importing it dies on load. It was deleted on 2026-09-09 rather
   than left as a live-looking file that invites someone to import RLS-bypassing
   code into the web app. Everything in the web app runs as the signed-in user.

5. **Trade transfers live in `public.accept_trade`**, a `SECURITY DEFINER`
   function (migrations 9 → 12 → 13). Changes to trade completion go there or
   into a new numbered migration — **never into a loosened RLS policy.**

6. **Ownership and location stay decoupled.** The transfer is one statement:
   `update card_instances set owner_user_id = …, location_id = null`. No
   composite FK, no denormalised owner, no generated column.
   `supabase/tests/schema_test.sql` asserts this. If it starts failing, the
   trade engine just got harder.

7. **`ownership_history` rejects UPDATE and DELETE at the trigger level.** An
   audit log you can quietly edit is not an audit log.

8. **Never edit an applied migration.** Add a new numbered file. Naming is
   `000000000000NN_snake_case_name.sql`, and the header explains the *why*.

9. **`AGENTS.md` is machine-written by `next dev`** and re-created if deleted.
   Do not edit it, do not fight it — commit it if it reappears in a diff.

## Two reversible bets, both deliberate

Phase 0 user validation was skipped, so two schema choices are educated guesses,
each kept cheap to reverse. Treat them as open questions, not settled facts.

- **Stacking.** Whether identical copies collapse into one row with a `quantity`
  is a policy that lives *entirely* in `src/lib/collection/stacking.ts`. The
  database does not enforce it — the absent unique constraint on the stack key
  is intentional. Flip `STACKING_ENABLED` to `false` for strict
  one-row-per-physical-card; no migration needed.
- **Location nesting.** One level, enforced by the `locations_enforce_nesting`
  trigger rather than by the table's shape. No business logic reads
  `parent_location_id`.

---

## Commands

```bash
npm run dev          # dev server (or use the "dev" config in .claude/launch.json)
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # tsx --test scripts/*.test.ts — pure logic in src/lib/**
npm run test:db      # migrations against a throwaway Postgres; needs PGHOST/PGURL
npm run sync:scryfall            # ~500MB, several minutes
npm run sync:scryfall -- --limit 5000   # quick smoke test
```

Before proposing any change as done: `npm run lint && npm run typecheck && npm test`.

## Specialised rules

Read the matching file before working in that area:

- `supabase/migrations/**` → [`.claude/rules/migrations.md`](.claude/rules/migrations.md)
- `src/app/**` → [`.claude/rules/app-router.md`](.claude/rules/app-router.md)
- `scripts/*.test.ts` → [`.claude/rules/testing.md`](.claude/rules/testing.md)
- `src/lib/supabase/**`, any RLS work → [`.claude/rules/data-access.md`](.claude/rules/data-access.md)

## Session hygiene

One task per session. `/clear` between unrelated tasks, `/compact` when a
session runs long. Disable unused MCP servers with `/mcp` — they cost context on
every request whether or not they are used. Prefer the cheapest model that can
do the job; see `.claude/ORGANIZATION.md` for which agent that means.

## History

Planning material from before 2026-09-09 is in `archive/pre-rebuild-2026-09-09/`.
It is evidence, not direction — read its `README-ARCHIVE.md` first.
