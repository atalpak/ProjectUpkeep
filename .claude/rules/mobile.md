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

## What is NOT shared with the web app, and why

- **`src/lib/collection/stacking.ts` is not imported here, on purpose.**
  Mobile currently inserts one `card_instances` row per confirmed scan
  (`packages/scan-core/src/writer.ts`) rather than merging into an existing
  stack. That is a deliberate, temporary phase-one limitation — scanning into
  an existing stack (matching the web app's stacking policy) is a later phase
  with its own migration and its own architect pass, not something to
  "helpfully" wire up by importing the web app's stacking module. If you find
  yourself reaching for `stacking.ts` from mobile code, that is the signal to
  stop and escalate rather than build it.
- Own-collection queries still need explicit owner scoping here, the same
  discipline as `.claude/rules/data-access.md` describes for
  `src/lib/collection/queries.ts` — `locations` is filtered on `user_id` (not
  `owner_user_id`; that column belongs to `card_instances`, not `locations` —
  see `supabase/migrations/00000000000004_locations.sql`) precisely because a
  friend's tradable/public rows are legitimately reachable through RLS.
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
