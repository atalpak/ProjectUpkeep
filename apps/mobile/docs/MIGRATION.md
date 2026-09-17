# Connect the first mobile phase to Project Upkeep

## Verified target contracts

The separate `/Users/anthonytalpak/ProjectUpkeep` checkout is Next.js 16 + React + Supabase. It was inspected read-only. The authoritative paths there are:

- `src/lib/types.ts`: condition, finish, language vocabulary.
- `src/lib/collection/stacking.ts`: shared web stacking policy.
- `src/app/(app)/collection/actions.ts`: current authenticated add action.
- `supabase/migrations/00000000000003_cards.sql`: catalog.
- `supabase/migrations/00000000000005_card_instances.sql`: verify the filename against your checkout; table and RLS definitions are authoritative.

The scanner returns `cards.id`, the Scryfall **printing** UUID. It never writes an `oracle_id` as a physical card's identity. Collection rows use `card_instances`, not `collection`. The “Unsorted” destination is `location_id: null`, not a specially named location row. Finish vocabulary includes `glossy` in addition to `nonfoil`, `foil`, and `etched`; conditions are `NM`, `LP`, `MP`, `HP`, `DMG`.

## 1. Build a catalog from the existing sync

Export public card metadata from the existing trusted Upkeep sync job as JSON Lines, one printing per line. `scripts/export-catalog.sql` lists the fields. For a development database with an already configured connection:

```sh
psql "$UPKEEP_DATABASE_URL" -At -f scripts/export-catalog.sql > /tmp/upkeep-cards.jsonl
npm run catalog:build -- /tmp/upkeep-cards.jsonl /tmp/catalog-v1.json 2026-09-16
```

Do not embed database URLs or server keys in mobile code. The command above is an instruction for the developer's existing export environment, not a requirement to give the scanner database credentials.

The builder validates exact printing IDs, vocabulary, duplicate IDs, version metadata, and a 40 MB size budget. It consumes a stream instead of parsing a giant Scryfall bulk array. It still builds the final compact bundle in memory. Filter to paper records and an initial supported language/catalog slice if the full export exceeds the budget. Cards with no oracle ID are excluded in this first phase; decide token support separately.

Publish the resulting **public card metadata** JSON at an HTTPS URL through your existing hosting/storage pipeline. Include alternate printed names and face names in `card_faces` where available from the daily sync: the current database export only guarantees `flavor_name`. There is no automatic new server job installed by this workspace.

## 2. Configure a development backend

Copy `apps/mobile/.env.example` to `apps/mobile/.env`, then set your existing Supabase URL, public publishable (or anon) key, and catalog URL. These values are compiled into the app. Never use a service-role or secret key.

Rebuild/restart the development app, sign in with an existing email/password account, and tap **Refresh offline catalog**. Without a real catalog, the synthetic demo records cannot be saved to Supabase; the review button explicitly says “Add to demo session.” The new client can use the same account as the web app but needs its own auth session.

No live account was used during this build. Confirm URL settings, email/password provider availability, RLS, and location constraints in a development Supabase project before testing production data. OAuth/deep links, password reset, and registration are future mobile-shell work (persistent auth shipped in phase 1b).

## 3. Collection write semantics — as of Phase 3a (superseded)

This section originally described a phase-one, insert-only design: one new
`card_instances` row per confirmed scan, with the operation UUID doubling as
`card_instances.id` for a limited, row-lifetime-only replay check. Phase 3a of
the mobile initiative (2026-09) replaced that with the same merge-vs-insert
stacking policy the web app has always used, applied atomically. It is kept
here, struck through in spirit, as the record of what changed and why —
`.claude/rules/mobile.md` is the current source of truth going forward.

What changed:

- The stacking *decision* (`decideStacking`, previously web-only in
  `src/lib/collection/stacking.ts`) moved to a new framework-free workspace
  package, `packages/upkeep-domain`, that both the web app and
  `packages/scan-core` now import. `stacking.ts` is a thin re-export for its
  existing web callers.
- A new migration (`00000000000036_atomic_stack_merge.sql`) added
  `public.apply_stack_addition`, a `security invoker` function that performs
  whichever instruction the decision above produced — merge into a specific,
  re-verified row via an atomic `quantity = quantity + p_quantity ... for
  update`, or insert — plus `public.collection_write_ops`, a durable
  operation ledger keyed by the client-minted operation id. Both clients now
  route every confirmed add through this one function instead of writing
  `card_instances` directly.
- `apps/mobile/src/backend.ts`'s writer looks up merge candidates (filtered
  explicitly by owner), decides through the shared policy, and calls
  `apply_stack_addition` via RPC. A "stale target" response (the decided row
  changed shape between the read and the call) triggers one automatic
  re-decide-and-retry with the same operation id before surfacing anything —
  safe, because a failed call rolled back before ever writing a ledger row.

The previous paragraph's "extract a shared authenticated mutation service...
implement transactional quantity increment and a durable operation ledger
together... test concurrent web/mobile writes, replay after a lost response,
cross-account access, and location ownership" is exactly what
`00000000000036_atomic_stack_merge.sql` and its seven schema-test assertions
now cover — see `supabase/tests/schema_test.sql` section 14.

## 4. Move into a future Upkeep monorepo

1. Copy `packages/scan-core`, `packages/upkeep-vision`, and `apps/mobile` into the new workspace and retain their package names.
2. Retain workspace dependencies and SDK-compatible native versions from this lockfile. Configure Metro through Expo's monorepo defaults.
3. Regenerate only the **mobile** native projects with `npx expo prebuild`, then build. Do not run prebuild at the legacy Flutter root.
4. Replace the mobile adapter with your shared collection write service when it is available; `CollectionWriter` is the boundary.
5. ~~Move duplicated condition/finish/language types into one neutral shared domain package, consumed by web and scan-core.~~ Done in Phase 3a: `packages/upkeep-domain`. Do not import Next.js server actions into React Native.
6. Keep `scan-core` usable from web without native imports. Validate the catalog and authenticated write behavior after relocation.

## Acceptance gate

Sign in to the same test account in web and mobile, download a real catalog, scan/select an exact printing, choose foil and a non-default condition, save two copies into Unsorted, and verify those fields in the web collection. Repeat to an owned location; confirm a foreign location is rejected. Simulate a lost response and kill/relaunch before acknowledgement: retry must verify the existing ID without increasing quantity. Only then call the backend integration validated.
