---
paths:
  - "apps/mobile/**"
  - "packages/**"
description: The Expo/React Native workspace layout, its native-module boundary, and what it deliberately does not share with the web app yet.
---

# Mobile (Expo SDK 55, React Native 0.83)

Merged into this repo from a separate scanner prototype (`MTGCardScanner`) as
npm workspaces. It is a phase-one scan-and-confirm shell, not a port of the web
app — see `apps/mobile/docs/ARCHITECTURE.md` and `HANDOFF.md` for the fuller
history.

## Workspace layout

```
apps/mobile/            Expo app. App.tsx is the whole UI in this phase.
  src/backend.ts        Supabase client (anon key), the collection writer, auth storage
  src/catalog.ts         offline catalog cache (two alternating disk slots)
  docs/                  README / HANDOFF / MIGRATION / ARCHITECTURE / QUALITY_REVIEW / VALIDATION
packages/scan-core/      Pure TS: catalog parsing/search, scan pipeline, draft
                        validation, the collection writer. No RN/Expo imports —
                        this is what makes it unit-testable with node's test
                        runner, the same shape `src/lib/**` uses on the web side.
  scripts/               build-catalog.ts, benchmark.ts, export-catalog.sql,
                        patch-native-toolchain.cjs — catalog tooling and the
                        RN/Gradle compatibility patch. Deliberately separate
                        from the repo's root scripts/, which is `src/lib/**`'s
                        unit-test suite plus the Scryfall sync job; mixing the
                        two would make scripts/ mean two unrelated things, see
                        `.claude/rules/testing.md`.
  test/core.test.ts      scan-core's own tests, run via `npm test -w @upkeep/scan-core`
packages/upkeep-domain/  Pure TS, no RN/Expo imports AND no web-framework
                        imports either — this is the one package both
                        `src/lib/**` (the Next.js app) and `packages/scan-core`
                        import from. Currently the stacking-decision policy
                        (`decideStacking`, `STACKING_ENABLED`) and the
                        condition/finish/language-code vocabulary. See its own
                        header comments and CLAUDE.md's "two reversible bets"
                        section for why the policy lives here rather than in
                        the database.
packages/upkeep-vision/  Native module boundary: Swift (iOS) / Kotlin (Android)
                        OCR/vision primitives, exposed through a thin `index.ts`.
                        Anything that needs a camera frame, on-device text
                        recognition, or platform vision APIs lives here, not
                        in scan-core.
```

## Running it

- `npm test -w @upkeep/scan-core` / `npm run typecheck -w @upkeep/scan-core` —
  the pure logic, from the repo root.
- `npm run typecheck -w @upkeep/scanner-app` — the app itself.
- `apps/mobile`'s own `start`/`ios`/`android` scripts run Expo; they are not
  part of the root `npm test`/`npm run typecheck`/`npm run lint`, which stay
  scoped to the Next.js app (see the root `tsconfig.json` excludes and
  `eslint.config.mjs` ignores for `apps/**` and `packages/**`).
- `apps/mobile`'s `postinstall` patches an RN/Gradle compatibility issue and is
  scoped to that workspace's own `package.json` for exactly this reason: it
  must never be able to fail a web-only `npm ci` at the repo root.

## What IS shared with the web app now, and what changed

- **The stacking policy is shared, as of Phase 3a of the mobile initiative
  (2026-09).** It used to live only in `src/lib/collection/stacking.ts`, and
  this file used to say reaching for it from mobile was a stop-and-escalate
  signal — mobile inserted one `card_instances` row per confirmed scan
  (`packages/scan-core/src/writer.ts`) rather than merging into an existing
  stack, deliberately, because doing that safely under two independent
  writers (a phone racing a laptop, or two phones) needed its own migration
  and its own architect pass first. That pass happened: `decideStacking` now
  lives in `packages/upkeep-domain`, `src/lib/collection/stacking.ts` is a
  thin re-export of it, and both `src/app/(app)/collection/actions.ts`'s
  simple add and mobile's scanner apply a decision through the same atomic
  database function, `public.apply_stack_addition`
  (`supabase/migrations/00000000000036_atomic_stack_merge.sql`) — see that
  migration's header for why the write needed to become atomic, and
  `packages/scan-core/src/writer.ts`'s header for what makes retrying it safe.
  **The bulk CSV import (`src/lib/import/commit.ts`) and both deck-move
  actions (`src/app/(app)/decks/actions.ts`) still use the older inline
  read-decide-write** — wiring those to `apply_stack_addition` too is future
  work, not done by this phase.
- If you find yourself reaching for something in `packages/upkeep-domain` and
  it is not there yet, that is a normal "add it" — the escalation signal that
  used to apply to `stacking.ts` specifically no longer does, now that this
  package exists precisely to be shared. A *new* database write path that
  bypasses `apply_stack_addition` for a stacked write, or that touches
  `owner_user_id`/`accept_trade`'s territory, is still a stop-and-escalate.
- Own-collection queries still need explicit owner scoping here, the same
  discipline as `.claude/rules/data-access.md` describes for
  `src/lib/collection/queries.ts` — `locations` is filtered on `user_id` (not
  `owner_user_id`; that column belongs to `card_instances`, not `locations` —
  see `supabase/migrations/00000000000004_locations.sql`) precisely because a
  friend's tradable/public rows are legitimately reachable through RLS.
- **Sleeve/unsleeve, as of Phase 4b/4c of the mobile initiative (2026-09).**
  Moving a card into or out of a deck is a MOVE, not an addition: an existing
  `card_instances` row changes `location_id`, and the total owned must not
  change — a lost half of that write can destroy a copy that was already
  owned, which is a strictly worse failure than `apply_stack_addition`'s
  "a scanned copy never lands" case. `public.apply_stack_move`
  (`supabase/migrations/00000000000038_atomic_stack_move.sql`) is the atomic
  function both `apps/mobile/src/decks.ts`'s sleeve/unsleeve pickers (in
  `App.tsx`'s `DeckDetailScreen`/`SleevePicker`) and, eventually, a rewritten
  web deck action would go through — see that migration's header for the full
  shape (ledger-first idempotency, a locked and re-verified source row, the
  same insert-or-merge destination logic as migration 36) and
  `packages/scan-core/src/move.ts` for the client-side retry wrapper
  (`createMoveWriter`), which is deliberately asymmetric: a stale destination
  target is re-decided and retried once (mirroring `writer.ts`), while a stale
  source has nothing to re-decide and is retried once identically, then
  surfaced.
  Migration 38 also depends on migration 37, added in the same phase: the
  deck-list-follows-contents trigger (migration 16, refined by 19 and 20) used
  to fire only on `INSERT` or `UPDATE OF location_id` on `card_instances`,
  never on a plain quantity change — so sleeving into an already-sleeved stack
  (exactly what `apply_stack_move`'s merge branch does) was invisible to it,
  and `deck_cards` silently under-counted. Migration 37 adds the missing
  `AFTER UPDATE OF quantity` trigger, wired to the same, unmodified
  reconcile function from migration 20 (confirmed monotone-up and
  total-comparing before wiring it up — see that migration's own header for
  why that made it safe to reuse without changing the function itself).
- **Plain deck-list editing is still deferred.** Adding a card to a deck's
  list that is not yet owned (an unowned-card catalog lookup, closer to the
  scan flow's printing search than to a database write) or removing a list
  entry without unsleeving its physical copies first has no mobile UI yet —
  only the physical sleeve/unsleeve action, which is what phase 4b/4c
  approved. The web app's `addDeckCard` / `removeDeckCard` /
  `setDeckCardQuantity` (`src/app/(app)/decks/actions.ts`) remain the only way
  to edit a decklist directly.
- `EXPO_PUBLIC_*` variables follow the same rule as `NEXT_PUBLIC_*` in
  `CLAUDE.md`'s hard constraint 2: read as literal `process.env.EXPO_PUBLIC_*`
  member expressions, never dynamic `process.env[name]` access.

## Auth persistence

`apps/mobile/src/backend.ts` persists the Supabase session across restarts via
a `SecureStore`-backed `auth.storage` adapter — see the comment there for why
the value-size concern historically associated with SecureStore does not apply
on this SDK version. Persisting the session does not mean a pending scan
replays itself automatically: `App.tsx`'s recovery effect surfaces a recovered
pending write for an explicit retry/verify tap, and sign-out clears both the
persisted session and that account's pending-write key. `signInWithPassword`
is the only auth path in this phase — no password reset, OAuth, deep links, or
registration yet.
