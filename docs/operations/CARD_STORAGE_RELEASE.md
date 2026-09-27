# Card storage cutover

Prepared 2026-09-27. Production migration 50 is applied. Migration 51 remains
unapplied after its first attempt hit a statement timeout and rolled back.
Compaction has not run.

## First maintenance window

PR 104 merged as `f7f400e`. The scheduled writer was disabled and both catalog
writers were idle. Migration 50 completed; migration 51 timed out while preparing
printing exceptions (statement 8). Its transaction rolled back completely.
All catalog and customer row fingerprints match their pre-cutover values, and
live anonymous catalog export succeeded. Sync scheduling was re-enabled within
the approved window. The September 18 sync record still marked running is stale;
no corresponding job or writing session exists and its history was left unchanged.

The unapplied migration 51 now materializes the canonical shared projection once
per Oracle row, builds only the 13 required printing fields, and disables JIT
for its bounded scans. This avoids repeatedly serializing large unused fields.
The full-catalog backfill took 3.12 seconds locally and retained the same 307
exceptions; its parity check took 5.00 seconds. The schema/RLS and concurrent-writer
suites pass. The fix was reviewed with no remaining blockers. A new maintenance
window is required for the retry and compaction; the public API remains compatible
at migration 50 meanwhile.

## Verified results

- All 118,628 public printing rows returned identical JSON before normalization
  and after both normalization and compaction. 307 printing exceptions preserve
  divergent rules, explicit nulls, and the 221 printings missing Oracle rows.
- Clean local PostgreSQL 16 storage: 191 MB before, 146 MB after normalization,
  108 MB after compaction. The 83 MB reduction is 43%; production's 330 MB table
  has additional bloat, so this is a clean comparison rather than a production
  savings guarantee. Local compaction took 3.25 seconds.
- Local query samples, old → normalized: name suggestions 0.22 → 0.40 ms;
  catalog first page 1.01 → 3.89 ms; legacy type filter 6.58 → 49.11 ms;
  legacy rules filter 1.44 → 93.27 ms. Shared-field CASE expressions prevent
  those legacy filters from using canonical trigram indexes directly. Submitted
  web/mobile searches use Scryfall; name suggestions still use the printing index.
- Full schema/RLS suite, nullable override tests, actual concurrent Oracle and
  printing writers in both orders, and 26 local PostgREST HTTP contracts pass on
  both production's exact version 14.5 and version 16.4.
- 1,040 application tests pass. Typecheck passes. Lint has zero errors and two
  existing mobile AppProvider hook warnings. Read-only reviewer found no remaining
  commit blockers after the RPC batch-size clamp.
- Normalization rollback SQL was executed successfully against a scratch schema.
  It restores effective shared fields and keeps the new ingest writer compatible.

The full-catalog parity test uses materialized JSON projections before comparing
them. Joining the expanded view directly in a FULL JOIN spilled wide rows to
disk; that scratch-only comparison was cancelled and rerun successfully.

## Recovery and capacity gate

Supabase's backup listing currently returns `backups: []`, `pitr_enabled: false`.
This is not a verified platform restore point. The public catalog snapshots used
for the successful local reconstruction are saved, compressed and checksummed,
under ignored `.cache/card-storage-backup/`. They contain no customer records.
They are catalog recovery evidence, not a substitute for a complete database
backup. The CLI schema dump initially failed because Docker/Podman is unavailable;
matching PostgreSQL 17 tools were subsequently downloaded into temporary storage.
The owner explicitly approved the private application/authentication backup.
`.cache/card-storage-backup/app-before-2026-09-27.dump` is complete (38,002,700
bytes), permission 0600 in a 0700 ignored directory, with its checksum recorded
in private `RESTORE_VERIFICATION.json`. All 46 archived tables restored with
matching counts, including 118,628 printings. PostgreSQL 17's unsupported timeout
setting was omitted for the local PostgreSQL 16 restore; schema creation was
made idempotent and pgcrypto, uuid-ossp and pg_trgm prerequisites were supplied.
Migrations 50–51 then passed on that restored production copy: every printing
retained identical JSON and all non-catalog customer-table fingerprints remained
unchanged. This is an application/authentication logical backup, not a platform
backup of Storage file contents or infrastructure.

Before production writes, obtain and verify a restorable database/schema backup
and confirm actual free disk and temporary rewrite headroom. Production was
388 MB total at audit. Removing the redundant printing indexes recovers about
67 MB before compaction. Budget at least another full target printing relation
plus temporary sort/WAL headroom; do not infer filesystem capacity from the
database's logical size or its plan quota. The production Infrastructure dashboard
was subsequently verified: 0.68 GB used of 2 GB provisioned (35%), leaving about
1.32 GB available, including WAL and system usage in the reported utilization.
This exceeds the estimated printing rewrite/sort/WAL headroom; recheck immediately
before the separately approved production maintenance window.

## Coordinated release

1. Confirm approved maintenance window, verified recovery, capacity, and the
   deployed PostgREST version. Keep heap compaction separately approved.
2. Pause scheduled Scryfall workflow. Ensure **both printing and Oracle writers**
   are idle, including manually launched jobs. Keep both paused through rollback
   if recovery is needed.
3. Merge the reviewed writer and migrations together. Scheduled jobs run `main`;
   a schema cutover with the old writer still runnable is unsafe. Do not resume
   either writer between migration 50 and 51.
4. Apply new migrations using the owner's linked production migration workflow.
   Both use a 5-second lock timeout. A lock failure aborts that migration; inspect
   blockers and retry during the window rather than raising the timeout blindly.
5. Reload PostgREST schema cache (migration notifications do this). Probe public
   cards fields and owner-scoped collection/deck/want/trade embeddings, including
   `cards!inner`, FK hints and child filters. Compare catalog count and sampled
   original printing fields with the preserved snapshot. Test atomic reprint/rekey.
6. Run a watched printing sync and catalog export with the new writer; then the
   Oracle loader. Verify success records, preserved printing rules, unchanged
   price timestamps, public catalog publication, and migration drift checks.
7. Resume the workflow only when all checks pass. Record actual recovered index
   bytes and any remaining heap recovery.
8. In the separately approved window, run only
   `VACUUM (FULL, ANALYZE) public.card_printings` outside a transaction, with
   bounded lock acquisition and a monitored duration/space budget. This takes
   an exclusive printing-table lock and can interrupt web/mobile catalog reads.
   The 3.25-second local measurement is not a production duration promise.
   Record before/after sizes and rerun read-only API checks.

## Recovery

If normalization fails within its migration transaction, PostgreSQL rolls that
migration back. Migration 50 may remain applied; keep the new RPC writer and
compatibility view in place until the fault is understood.

For a completed normalization requiring recovery, pause both writers, confirm
maintenance approval and recovery headroom, then execute
`docs/operations/CARD_STORAGE_ROLLBACK.sql` with a privileged owner connection.
It reconstructs all shared columns from the effective view, verifies exact JSON
parity before commit, restores the old rules indexes, and retains migration 50's
API boundary. It does not edit customer rows. Do not erase applied migration
history; capture this recovery as a corrective migration before another release.

If the effective view itself is damaged, use the verified pre-cutover backup
instead. Do not improvise customer-table or foreign-key reconstruction.
