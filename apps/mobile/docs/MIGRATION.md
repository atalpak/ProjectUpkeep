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

## 3. Collection write semantics — explicit phase-one difference

`apps/mobile/src/backend.ts` adapts the framework-free `createCollectionWriter` to the ordinary Supabase client. It obtains the current user, inserts a row with that owner, and lets existing RLS/triggers enforce access. No new table or privileged function is needed for this phase.

Each confirmed scan is **one new collection row**, with the selected quantity. This is legal in the inspected schema, which deliberately has no unique constraint on stack identity. It differs from the web UI, which merges matching stacks. The scanner does not copy the web's concurrent read/modify/write quantity pattern: that could lose additions from two devices.

The operation UUID becomes `card_instances.id`. If an INSERT response is lost, retry uses the same UUID. A duplicate/error is accepted as success only after fetching that exact row under RLS and checking every submitted field and owner. An error never causes a new UUID to be minted. This gives replay protection while that row exists and is unchanged. It is not a permanent operation ledger: deleting or editing the row before reconciling an uncertain save needs manual recovery.

Before enabling web-identical stacking, extract a shared authenticated mutation service used by **both** web manual/CSV and mobile paths. Implement transactional quantity increment and a durable operation ledger together. Reuse `stacking.ts` policy; do not hardcode a second competing policy in the scanner. Test concurrent web/mobile writes, replay after a lost response, cross-account access, and location ownership. No such database change has been applied here.

## 4. Move into a future Upkeep monorepo

1. Copy `packages/scan-core`, `packages/upkeep-vision`, and `apps/mobile` into the new workspace and retain their package names.
2. Retain workspace dependencies and SDK-compatible native versions from this lockfile. Configure Metro through Expo's monorepo defaults.
3. Regenerate only the **mobile** native projects with `npx expo prebuild`, then build. Do not run prebuild at the legacy Flutter root.
4. Replace the mobile adapter with your shared collection write service when it is available; `CollectionWriter` is the boundary.
5. Move duplicated condition/finish/language types into one neutral shared domain package, consumed by web and scan-core. Do not import Next.js server actions into React Native.
6. Keep `scan-core` usable from web without native imports. Validate the catalog and authenticated write behavior after relocation.

## Acceptance gate

Sign in to the same test account in web and mobile, download a real catalog, scan/select an exact printing, choose foil and a non-default condition, save two copies into Unsorted, and verify those fields in the web collection. Repeat to an owned location; confirm a foreign location is rejected. Simulate a lost response and kill/relaunch before acknowledgement: retry must verify the existing ID without increasing quantity. Only then call the backend integration validated.
