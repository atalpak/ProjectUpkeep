# Card storage cleanup — impact map and release plan

2026-09-27 · Owner requested storage cleanup and approved the architect's plan.
Migrations 50–51 and the matching sync writer are implemented and undergoing
local full-catalog validation and review. Production remains unchanged.

## Current evidence

Live Supabase inspection: 118,628 printing rows with zero null Oracle IDs; database 388 MB, `cards` 330 MB (214 MB heap and 116 MB
indexes), `oracle_cards` 44 MB. Latest three GitHub Scryfall runs succeeded and
none was running at inspection. Statistics span approximately 27 days.

`cards_oracle_text_trgm_idx`: 53 MB, zero recorded scans.
`cards_type_line_trgm_idx`: 14 MB, 77 recorded scans.
Retain the used name, Oracle ID, set/collector, name equality, and flavor-name
indexes. Zero scans alone is not permission to remove every index: evaluate
reader contracts and future queries for this specific migration.

Read-only aggregate audit is reproducible with
`supabase db query --linked --file docs/operations/CARD_STORAGE_AUDIT.sql`.
It compares nullable values with `IS DISTINCT FROM` and selects no customer records.
The first combined request timed out; a revised single-pass query succeeded.
Live results: 221 printings across 216 Oracle IDs have no Oracle row. Among matched
rows, mana_cost differs on 3 printings, cmc/type_line/layout each on 82,
game_changer on 3, keywords and produced_mana each on 1. Rules text, colors,
color identity, power, toughness, and loyalty have zero differences. Counts overlap.
Do not replace divergent values simply because a canonical row exists.

## Approved implementation plan

### A. Introduce the compatibility boundary

Rename physical `cards` to `card_printings` and retain its current columns.
Expose the same public `cards` fields in an explicitly listed security-invoker
view. Preserve direct printing projections of `scryfall_id` and `oracle_id`,
existing foreign-key constraints, and read-only client grants/RLS. Do not change
phone or web query strings merely to accommodate the migration.

Move sync hash reads, exact counts, and upserts to the physical table. A view
cannot supply the current ON CONFLICT writer contract. Prepare matching workflow
and code before cutover; pause sync only during the cutover, not during design.
Rollback at this phase can restore the original table API while data is retained.

Refresh PostgREST cache and prove direct reads plus `cards(...)`,
`cards!inner(oracle_id)`, filters, and many-to-one object shapes on an isolated
PostgREST instance before production. Define computed to-one relationships only
if testing proves they are needed. PostgreSQL FK survival is insufficient proof
of installed-mobile embedding compatibility.

### B. Normalize with exact fallback coverage

Candidate shared fields: mana_cost, cmc, type_line, oracle_text, colors,
color_identity, keywords, power, toughness, loyalty, produced_mana, game_changer,
layout. Keep printing name, flavor_name, images, rarity, language, prices,
flavor text, artist, set metadata, and card_faces on printings.

Missing/null Oracle IDs and differing values must retain exact fallbacks, including
explicit nulls. A simple COALESCE is not sufficient. Use compact per-printing
fallback/override data, validated across every current row before column removal.
Preserve printing identity and all user-owned foreign keys. No user data is moved.

**Authority decision proposed:** preserve the latest successful default_cards
printing snapshot exactly. This cleanup must not silently substitute newer Oracle
values or reinterpret printings when only the Oracle loader runs.

The compact override scheme must handle changing canonical rows: before an Oracle
field update, freeze the old effective values for affected printings when the new
canonical value differs, including explicit nulls. A narrowly scoped database
trigger can maintain these exceptions without widening the loader's grants.
Its helper must have a pinned search_path, revoked direct client execution, and
access only to the necessary catalog fallback data. Include this in schema review.

Each printing-sync ingest compares all shared source fields with the current
canonical row, maintaining/removing overrides even when the printing payload hash
is unchanged. Missing Oracle rows retain a complete shared-field fallback. The
ingest path must keep price hashes and catalog publish bookkeeping correct; no
extra writes to unchanged printing rows are required. Test source-first, Oracle-
first, failed Oracle loads, and later corrections. Field removal waits for exact
API parity across current rows and these sequences.

Recreate `collection_entries`, which currently binds to the physical table.
Recreate atomic reprint/rekey functions with record or compatibility-view row types:
rename preserves their old composite type dependency while body text still reads
`public.cards`. Dropping fields without repairing that would break collection actions.
Audit all textual cards references in functions and rerun full schema tests.

Remove duplicate printing type/rules indexes only after reader/performance checks.
The measured index portion is approximately 67 MB; heap recovery is additional
but must be measured, not assumed to equal a historical estimate.

### C. Reclaim heap storage

DROP COLUMN does not remove the bytes from existing live tuples. A later table
rewrite/compaction is required. First reclaim redundant index space, then calculate
peak rewrite bytes and available capacity. Use a bounded maintenance window for
VACUUM FULL only after checking the lock and capacity budget. Do not rewrite the
whole database. Recheck relation and database sizes after completion.

This step blocks printing reads/writes for the duration of the rewrite. Duration
and capacity must be measured before execution. If measured capacity or
an acceptable window is unavailable, leave heap compaction pending rather than
risking the database's disk limit.

## Validation before release

- Apply all migrations to throwaway Postgres; run full schema/RLS invariant suite.
- Test two-user read/write restrictions, anonymous public reads, narrow sync rights,
  atomic collection operations, orphan/null Oracle IDs, exact null/difference overrides.
- Contract probes for actual PostgREST embeddings used by installed mobile and web.
- Compare old/new API rows for single-face, DFC, reversible, tokens, digital, and
  alternate-name printings, plus catalog export counts/content.
- Simulate printing and Oracle load order/failures and hash/idempotency behavior.
- Lint, typecheck, unit tests, reviewer, deployment and scheduled-sync validation.
- Measure storage and query behavior before/after; record actual recovery.

## Production sequence

Finish local implementation and obtain review first. Verify backup/recovery options
and available disk, pause scheduled sync, ensure no active job, apply bounded-lock
migrations, deploy the matching writer/workflow, refresh schema cache, perform
read-only web/mobile contract probes, run watched sync/export, and resume schedule.
Heap compaction is a separate final operation with its own measured window.

The owner approved this architecture. Physical compaction approval will use the
measured interruption and space budget. Production cutover must coordinate the
scheduled writer with the schema; do not apply the migrations while the old
writer can run.
