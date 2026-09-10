---
paths:
  - "scripts/*.test.ts"
  - "scripts/verify-migrations.sh"
description: How tests are written and run in this repo.
---

# Testing

Two suites, deliberately separate.

```bash
npm test        # tsx --test scripts/*.test.ts  — pure logic, no database
npm run test:db # ./scripts/verify-migrations.sh — real Postgres, real RLS
```

## Unit tests

29 files in `scripts/`, one per module, named after what they cover
(`stacking.test.ts`, `import-plan.test.ts`, `trade-status.test.ts`, …). They use
node's built-in test runner through `tsx` — no Jest, no Vitest, **do not add a
test framework.**

They cover the *pure* logic in `src/lib/**`: mapping, streaming, stacking,
filters, import planning, pricing, want matching, deck state. Anything needing a
database belongs in the schema suite instead. If a piece of logic is hard to
test because it is tangled with a Supabase call, that is a signal to extract the
pure part — most of `src/lib` is shaped this way already.

New module in `src/lib/` → new `scripts/<name>.test.ts`. That is the pattern and
CI runs the whole glob, so a new file is picked up automatically.

## Schema tests

`scripts/verify-migrations.sh` applies every migration to a throwaway Postgres
and then runs `supabase/tests/schema_test.sql`. It stubs `auth.users` and
`auth.uid()`, so RLS isolation between two users is exercised without booting
Supabase. Needs `PGHOST`/`PGPORT`/`PGUSER` or `PGURL`.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, unit tests, a production build,
and the migration suite against `postgres:16` — on every pull request and every
push to `main`.

It also contains one **non-obvious guard**: after the build it greps
`.next/server/` for the placeholder Supabase URL. This catches a regression from
static `process.env.NEXT_PUBLIC_*` access back to dynamic `process.env[name]`,
which behaves identically under `tsx` but silently breaks production because
Next only inlines the static form. If that step fails, look at `src/lib/env.ts`.
