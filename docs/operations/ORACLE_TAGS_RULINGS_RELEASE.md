# Oracle tags and rulings release

This is additive catalog data. No customer rows or printing writer permissions
change. Apply migration 54 before deploying the web UI or scheduled loader.

## Local evidence (2026-10-03)

- The current Scryfall `oracle_tags` feed had 4,560 tags and 235,026 card links.
- The current `rulings` feed had 79,706 lines, including 43 exact duplicates;
  79,663 distinct rulings were stored. Two historical comments are a single
  nonbreaking space and were preserved.
- Both feeds loaded into a temporary PostgreSQL 16 database through the
  `scryfall_loader` role with verified TLS. A forced second load changed zero
  rows. The three tables and indexes occupied about 72 MB locally.
- Full migration/schema/RLS checks passed. The loader refuses short feeds
  before its transaction can remove any stored tag links or rulings.

## Production order

1. Check database headroom and that no other catalog migration is running.
   Apply migration 54 using the linked production migration workflow. It adds
   empty tables and extends only `scryfall_loader`'s catalog permissions.
2. Merge and deploy the matching loader and web UI. The scheduled workflow
   runs the new loader after the existing printing and Oracle steps, with its
   own warning-only outcome. Existing catalog publication is unaffected.
3. Run the workflow once and inspect `scryfall_sync_runs` for successful
   `oracle_tags` and `rulings` rows. Expect counts near the current feed sizes
   above; the exact counts can change with Scryfall's next export.
4. Verify a tag search and collection filter, a card with rulings, and a card
   without rulings. Confirm the next scheduled workflow skips unchanged feeds.

If either feed fails, leave the tables in place and inspect its failed run.
The loader stages and validates a complete feed before an atomic refresh; a
failed transaction leaves the prior public rows intact. The existing printing
sync, mobile catalog, and Oracle loader keep running independently.
