---
paths:
  - "supabase/migrations/**"
  - "supabase/tests/**"
description: Schema change conventions for Project Upkeep.
---

# Migrations

**Never edit a migration that has been applied.** Production and every
developer's database have already run it; changing the file makes the numbered
sequence a lie. Add a new numbered file instead.

- Naming: `000000000000NN_snake_case_name.sql`, `NN` continuing the sequence.
  28 files exist as of 2026-09-09.
- **Every migration opens with a comment explaining *why*.** This is the
  house style and it has repeatedly paid for itself — migration 20's header is
  the record of the `deck_cards` corruption. Match the surrounding tone: plain
  sentences about the decision, not a restatement of the SQL.
- New user-owned tables get row-level security in the same migration that
  creates them. A table that ships without RLS is a data leak, not a to-do.
- Write policies pin the ownership column in **both** `USING` and `WITH CHECK`,
  so a user cannot give a row away by updating the column. `card_instances` is
  the reference implementation.

## Things the schema must keep satisfying

`supabase/tests/schema_test.sql` is not a formality — it asserts invariants that
the product depends on:

- Ownership and location stay decoupled. A transfer is one `update` setting
  `owner_user_id` and nulling `location_id`. No composite foreign key, no
  denormalised owner, no generated column tying them together.
- RLS actually isolates two users. The test stubs `auth.users` and `auth.uid()`
  so this runs without booting Supabase.
- `ownership_history` rejects `UPDATE` and `DELETE` at the trigger level.

Trade completion belongs in `public.accept_trade` (a `SECURITY DEFINER`
function, migrations 9 → 12 → 13) or in a new migration. **Never loosen an RLS
policy to make a transfer work.**

## Verifying

```bash
npm run test:db     # applies every migration to a throwaway Postgres, then asserts
```

Needs a reachable Postgres via `PGHOST`/`PGPORT`/`PGUSER` or `PGURL`. CI runs it
against a `postgres:16` service container on every pull request, so a migration
that only works against the live database will fail there.

## Known unresolved

`deck_cards` is both the intended decklist and the record of what is physically
filed, and the two sync asymmetrically — automatically on add, manually on
remove. This has silently corrupted once (a 100-card deck became 114). **There
is still no invariant test for it.** Anything touching deck composition should
treat this as live risk.
