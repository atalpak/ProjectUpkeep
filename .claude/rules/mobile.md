---
paths:
  - "apps/mobile/**"
  - "packages/**"
description: The Expo/React Native app (four-tab shell, live iOS scanner, stage-then-commit write path), its workspace layout, the native-module boundary and rebuild rules, and what it deliberately does not share with the web app yet.
---

# Mobile (Expo SDK 55, React Native 0.83)

Merged into this repo from a separate scanner prototype (`MTGCardScanner`, a
Flutter app that still exists at `/Users/anthonytalpak/MTGCardScanner` and is
the *behavioural reference* for the live scanner) as npm workspaces. It has
grown from a scan-and-confirm shell into an app with a slim header, a menu of
every page and a five-slot nav bar (Scan fixed in the centre, the other four
chosen in Settings; default Collection, Decks, Locations, Wish list) with sign-in, but it is still not a full port of the web app:
Trades, Notifications and paste-only
Import (collection, not decks) are built; deck-*list* editing is web-only. Pages not yet built show a placeholder (`BUILT` in `src/navigation.ts`).
The docs in `apps/mobile/docs/` are historical apart from the "Current state"
sections at the top of `ARCHITECTURE.md` and `HANDOFF.md`; this file is the
current description, and where they disagree this file wins.

The app's display name is "Project Upkeep"; the bundle id / Android package is
still `dev.projectupkeep.scanner` (`apps/mobile/app.json`). Brand fonts differ
from the web app: mobile loads Cinzel + Plus Jakarta Sans (`App.tsx`,
`src/theme.ts`), web uses Fraunces + Inter (`src/app/layout.tsx`). That is a
known discrepancy, not yet a decision.

## Workspace layout

```
apps/mobile/            Expo app.
  App.tsx               Thin shell only: SafeAreaProvider -> fonts -> AppProvider
                        -> NavigationContainer -> RootShell. RootShell picks
                        demo-only / sign-in form / signed-in tabs, and hides its
                        header + banners while the live camera is on screen.
  index.ts              Expo entry point
  src/AppProvider.tsx   App-wide state: session/userId, the CardIndex + demo flag,
                        first-launch catalog download, locations, pending
                        sleeve/unsleeve, `scannerLive`, camera-stop registration
  src/navigation.ts     Route param types + the PAGES registry, menu order, default
                        nav slots, and which pages are BUILT (the rest are placeholders)
  src/preferences.tsx   Device prefs (theme mode, nav slots) in SecureStore, the
                        live dark/light scheme, and `makeStyles`
  src/screens/          ScanScreen · ScanSessionSummary · CollectionScreen ·
                        DecksScreen (commander-art tiles like the web deck list, plus "Start a deck"; data in src/decks.ts `fetchDeckTiles`) · DeckDetailScreen (commander-art banner, list grouped by type via `groupDeck` in @upkeep/domain, per-card sleeved/available/missing state, owns SleevePicker; `ManaCost` draws mana symbols) ·
                        SettingsScreen (appearance, nav bar, account, catalog) ·
                        PlaceholderScreen (pages not built yet)
  src/components/       TabBar (5 slots, raised Scan, + ScreenFade) · AppHeader
                        (Mort avatar, title, menu button) · MenuSheet · ScanQuickBar
                        · SearchOverlay (slide-in card search: name or Scryfall syntax + a Filters panel, results grid; queries `cards` via src/cardSearch.ts) · CardDetails (page-sheet for one card, opened from a result: printings, flip for double-faced cards, what you own, which friends have it / want it, legality + rulings fetched from Scryfall's API on demand, foil copies (and a "Preview foil" toggle) get a subtle holographic overlay that follows phone tilt via expo-sensors DeviceMotion, or a horizontal finger drag (`FoilArt`; needs a native rebuild for the tilt, guarded so an older binary just lacks it), add to collection via ConfirmScan, add to wish list; data in src/cardDetails.ts; also opened from Collection, deck lists and the Wish List) · DashboardScreen (value, totals, needs-attention, deck status, recently added; data in src/dashboard.ts) · WishlistScreen · LocationsScreen / LocationDetailScreen (containers with card counts, create/edit/delete, the open-for-trade switch; data in src/locations.ts, decks excluded) · FriendsScreen / FriendProfileScreen (username search, requests, a friend's trade binder and wants; data in src/friends.ts, rules live in migration 9's policies) ·
                        ListRow · ui. The centre Scan button is tap = Scan,
                        hold-and-drag = fan of Search / Scan (PanResponder in TabBar); keep the finger on the fan's Scan option ~0.35s and a camera box opens (quick scan: first read is matched with ScanPipeline and CardDetails opens at once on a best-guess printing, refined in the background -- see "Quick scan and the printing" below -- through `src/cardDetailsHost.tsx`; lifting first cancels; iOS only, needs camera permission already granted).
                        Search is an action (`src/searchOverlay.tsx`), not a route
                        anyone lands on, from the bar, the menu and the fan alike.
  src/mort/             Mort mascot: semantic reaction controller, MortStage,
                        and the real PNG poses in assets/. Web has a mirror in
                        src/components/mort/ and public/mort/.
  src/hooks/            useReducedMotion (web has its own in src/hooks/)
  src/theme.ts          Design tokens. Nothing else should hardcode a colour,
                        size, radius or duration. surface/border/text/accent/state
                        are LIVE objects switched by `applyScheme` (dark mode):
                        never `StyleSheet.create` them at module level -- use
                        `makeStyles(() => StyleSheet.create({...}))` and call the
                        returned hook in each component. Camera-overlay UI uses
                        fixed `brand.*` colours, not the scheme-aware tokens.
  src/backend.ts        Supabase client (anon key), the collection + move writers,
                        SecureStore auth storage
  src/catalog.ts        Offline catalog cache (two alternating disk slots)
  src/collection.ts     Collection-tab query (reads the collection_entries view)
  src/decks.ts          Deck-browse queries and sleeve/unsleeve helpers
  src/storage.ts        SecureStore key names for pending scan / pending move
  src/errors.ts         errorMessage / friendlyDbMessage
  docs/                 README / HANDOFF / MIGRATION / ARCHITECTURE /
                        QUALITY_REVIEW / VALIDATION / SCANNER_ALTERNATE_ART_PLAN
  ios/  android/        Generated by `expo prebuild`; gitignored, recreatable.
                        Do not hand-edit -- native source lives in
                        packages/upkeep-vision.
packages/scan-core/      Pure TS: catalog parsing/search, scan pipeline, draft
                        validation, the collection writer. No RN/Expo imports —
                        this is what makes it unit-testable with node's test
                        runner, the same shape `src/lib/**` uses on the web side.
  scripts/               build-catalog.ts, benchmark.ts,
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
                        import from. Currently the card-search filter model + Scryfall-syntax parser (`card-search.ts`; the web app still has its own older copy) and the stacking-decision policy
                        (`decideStacking`, `STACKING_ENABLED`) and the
                        condition/finish/language-code vocabulary. See its own
                        header comments and CLAUDE.md's "two reversible bets"
                        section for why the policy lives here rather than in
                        the database.
packages/upkeep-vision/  Native module boundary (Expo module name `UpkeepVision`,
                        package `@upkeep/vision`). Everything that touches a
                        camera frame or platform vision APIs lives here, not in
                        scan-core. Two halves:
                        - a native iOS *view*, `UpkeepScannerView` — the live
                          scanner (see "The live scanner" below) — backed by
                          `ios/UpkeepCardVision.swift`, the pure image maths
                          (rectangle scoring, contrast retry, perspective
                          correction, title/printing OCR);
                        - async functions: `readText(uri)` (photo OCR; iOS
                          Vision, Android ML Kit), `compareArtwork(uri,
                          refs)` (iOS-only feature-print ranking; Android
                          returns "not confident") and `rankCardImage(uri,
                          refs)` (whole-card feature-print distances, iOS only;
                          used by quick scan, see below). `compareArtwork` is
                          unused by any screen: it looks for a rectangle
                          inside the photo, which is wrong for an
                          already-straightened card.
                        `scripts/validate-detection.swift` is a dev tool: it
                        compiles the *shipped* UpkeepCardVision.swift against
                        still frames on a Mac, prints score/confidence/OCR and
                        writes a debug PNG, so detection can be tuned with no
                        phone. Usage is in its own header.
```

## Running it

- `npm test -w @upkeep/scan-core` / `npm run typecheck -w @upkeep/scan-core` —
  the pure logic, from the repo root.
- `npm run typecheck -w @upkeep/scanner-app` — the app itself. There are **no
  automated tests over the mobile screens**; scan-core and upkeep-domain are
  the tested surface.
- `apps/mobile`'s own `start`/`ios`/`android` scripts run Expo; they are not
  part of the root `npm test`/`npm run typecheck`/`npm run lint`, which stay
  scoped to the Next.js app (see the root `tsconfig.json` excludes and
  `eslint.config.mjs` ignores for `apps/**` and `packages/**`).
- `apps/mobile`'s `postinstall` patches an RN/Gradle compatibility issue and is
  scoped to that workspace's own `package.json` for exactly this reason: it
  must never be able to fail a web-only `npm ci` at the repo root.
- **A native module change needs a full native rebuild; a JS change does not.**
  Anything under `packages/upkeep-vision/ios|android` (or a new native
  dependency) is only picked up by rebuilding the dev client:
  `cd apps/mobile && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device <UDID>`.
  The `LANG`/`LC_ALL` matter: without them CocoaPods dies with an ASCII-8BIT
  encoding error. Pass the device **UDID** (`xcrun xctrace list devices`), not
  its name — a name stops matching if the phone is renamed. Edits to `.ts`/`.tsx`
  reload through the running Metro server (`npm run start -w @upkeep/scanner-app`,
  i.e. `expo start --dev-client`) with no rebuild.
- Relaunch the installed app without rebuilding:
  `xcrun devicectl device process launch --device <coredevice id> --terminate-existing dev.projectupkeep.scanner`.
- **The iOS Simulator has no camera**, so it cannot exercise scanning at all
  (the native view needs real frames). Scanner work is verified on a physical
  iPhone; the simulator is only good for the non-camera tabs.
- Expo Go cannot load the custom native module; a dev build is required.

## The live scanner (iOS only)

Rebuilt 2026-09-18 from a timer-driven "take a still every 1.2s and OCR it"
loop into a native live scanner, ported from the Flutter original's
`ios/Runner/AppDelegate.swift` and `lib/src/scanner/**`. `expo-camera` cannot
hand frames to native code, so the camera moved into `UpkeepScannerView`, which
owns its own `AVCaptureSession`.

**Native side** (`packages/upkeep-vision/ios/UpkeepScannerView.swift`). A
throttled frame (every 0.2s) goes through Apple Vision rectangle detection
(`UpkeepCardVision.bestCard`, with a contrast-enhanced retry), the outline is
drawn natively in gold, and a card must be steady for two consecutive frames
before it locks. A locked card is straightened by its detected quad, OCR'd (title
band + printing band), and emitted once as `onCardRead` (`{ title, lines,
printingLines, source }`; `source` is `outline` for an automatic lock, `guide`
for a manual capture). **One read per physical card:** the view will not read
again until the card has left (four empty detections, ~0.8s) or a clearly
different card has replaced it (centre jump > 0.15). Other events:
`onCardLost`, `onOutlineChange`, `onScannerError`. `captureNow()` (ref handle)
reads the corner-marked guide area — the fallback for full-art cards where
Vision finds no edge. Thresholds are constants at the top of the Swift files;
tune them with `validate-detection.swift`, not by guessing on a phone.

**JS side** (`apps/mobile/src/screens/ScanScreen.tsx`). `onCardRead` feeds the
text to `ScanPipeline.matchEvidence` (`packages/scan-core/src/pipeline.ts`,
pure and unit-tested), narrows by the set-lock if one is on, bands the result
(`scanBand`: confident / uncertain / none), and **stages** it. `continuous`
(default) stages immediately and lets the bottom sheet correct it; `single`
waits for an explicit Add. `ScanQuickBar` (behind the settings icon) sets the
defaults the *next* read uses: finish, language, set-lock, quantity. Nothing
already staged is touched by it.

**Stage, then commit — the rule that must not be broken.**
- Staged rows (`StagedCard`) live only in `ScanScreen`'s in-memory state. **Nothing
  is written to the database until "Add to collection"** on the session-review
  screen (`ScanSessionSummary.tsx`: filter, manual "+" add via `ManualAddSheet`,
  edit, delete, Clear, commit). A killed app loses the staged list by design.
- `commitAll` saves **row by row, sequentially** through `ConfirmScan` ->
  `createCollectionWriter` -> `apply_stack_addition` (migration 36), the only
  sanctioned add path. Each row's `id` is its `ConfirmScan` operation id, so a
  retry is idempotent.
- A row is removed only once its own save succeeds. A failed row stays staged and
  is marked `attempted`, which **freezes its draft**: the server rejects a reused
  operation id carrying a different draft, and the failed call may have landed,
  so editing would strand it and minting a new id could double-add. New scans of
  the same card start a separate row rather than merging into an attempted one.
- Demo mode (below) never reaches the database: `commitOne` short-circuits.
- `RecoveryPanel` exists only to clear a pending-scan record left by a pre-rebuild
  install (`upkeep.pending.<userId>`, read by `AppProvider`'s recovery effect);
  no current path creates one.

**Shell coupling.** The Scan tab is full-bleed (no header, banners or safe-area
insets, no tab bar) only while the camera view is mounted: `ScanScreen` sets
`scannerLive` in `AppProvider`, and `App.tsx` toggles chrome on it. The tab
navigator must stay in **one stable tree position** in `RootShell` — rendering it
in two branches remounts it and resets it to Scan. `app.message` is re-rendered
inside `ScanScreen` as an overlay for that window so a message is never hidden.

**Platform status.** iOS only. On Android there is no live scanner: `UpkeepScannerView`
is `null` unless `Platform.OS === 'ios'` (`scannerViewAvailable`), and Android has
only the photo `readText` path, which nothing in the current screen calls.
Callers must branch on `scannerViewAvailable`/`visionAvailable`.

**Quick scan and the printing.** Owner decision 2026-09-19, reversing the
earlier "never land on a printing silently" rule: quick scan must be fast, so it
opens CardDetails **immediately** and never asks "Which printing is this?".
The printing selector on the details page is the correction path; Add to
collection and wish list are enabled normally.

1. *Instant best guess* (`TabBar.handleRead`, all local): after the name match,
   scan-core's `printingHints` (footer: number and set on separate lines, leading
   zeros, rarity letter, number alone if the set is unreadable) and `rankPrintings`
   feed `bestGuessPrinting`: an exact or partial footer match, or the card's only
   printing. With no guess the sheet uses its normal default (`pickRepresentative`).
   Nothing waits on a download or comparison before the sheet opens.
2. *Fast paint* (`CardDetails`): the opened-on printing is fetched alone
   (`fetchPrinting`, one primary-key row) and shown with its price while the full
   printing list (`fetchPrintings`, up to hundreds of heavy rows) fills in.
3. *Background picture check* (`src/printingVerify.ts`, started only after the list
   has loaded): `onCardRead` carries `imageUri`, a temp JPEG of the straightened card
   (optional; the native side keeps the newest 12 and never deletes one younger than
   60s). `artCandidates` returns the printings to compare, or null when the footer
   was exact, there is one printing, there are more than 24, or one has no picture
   (a winner among a subset proves nothing, so the downloads would be wasted).
   Pictures go to `Paths.cache/printing-art` (newest 200 kept, temp-file-then-move,
   10s timeout, abandoned when the sheet closes) and are ranked with native
   `rankCardImage`. `artSwitchTarget` (pure, tested) then allows a switch only if the
   winner is confident AND every printing of the LIVE list was compared. CardDetails
   applies it only if the person has not picked a printing, opened the add form or
   used the wish list button, drops it if the sheet closed or the card changed, and
   shows a dismissable "Matched to SET #num by artwork" line. Any failure (old
   build, no photo, download, timeout) changes nothing.

Never override a manual choice. A foil-only or nonfoil-only printing needs no finish
choice: the add form already has one option. The main Scan tab (`ScanScreen`) does
not use the picture step. `npm run accuracy -w @upkeep/scan-core` reports the
footer's "needs verification" rate, on the illustrative sample only.

**Open items** (none of these are bugs to fix in passing): the rest of the
alternate-art plan (`apps/mobile/docs/SCANNER_ALTERNATE_ART_PLAN.md`: still-photo
footer capture, catalog printing-type flags, a real-card test set);
Android live scanning; the session list shows no prices (`Printing` has no price
field); the sequential per-card commit (an impact map recommends caching the user
id and prefetching merge targets before any batch RPC); no automated tests over
screens; the ~40 MB catalog is parsed synchronously on the JS thread at launch
(unmeasured).

## The catalog pipeline (mobile-app initiative phase 5)

The offline catalog the scanner searches against is built and published in
three steps, none of which lived at the repo root before this phase — the
previous `packages/scan-core/scripts/export-catalog.sql` had never actually
run against the real schema (`public.cards`'s primary key is `scryfall_id`,
not `id`) and nothing published a bundle anywhere.

1. **`scripts/export-catalog.ts`** (repo root, alongside `sync-scryfall.ts` —
   see that file's header and `.claude/rules/data-access.md` for why it lives
   there). Pages through `public.cards` over PostgREST with the **anon key**
   — `cards` already grants `select` to `anon` — and writes JSONL. Filters out
   `digital` rows, rows with no `oracle_id`, token/emblem/art-series layouts,
   and `memorabilia`-typed sets: none of those are something a user
   scans/sleeves. `card_faces`, `set_name`, `released_at` and `rarity` are
   selected too, for face-name aliases and the printing picker's display.
2. **`npm run catalog:build -w @upkeep/scan-core`**
   (`packages/scan-core/scripts/build-catalog.ts`). Maps that JSONL into a
   `CatalogBundle`. A bad row (an edge case real Scryfall data has and the
   old synthetic 3-card demo never did — Un-set cards, an empty
   `available_finishes`, an odd set code) is skipped and counted, not thrown
   on — the mapping itself (`buildCatalogRow`) lives in
   `packages/scan-core/src/build-row.ts`, tested the same way
   `src/lib/scryfall.ts`'s `toCardRow` is tested on the web side: pure
   function, no file or network needed to exercise it.
3. **`scripts/publish-catalog.ts`** (repo root). Uploads the built bundle to a
   public Supabase Storage bucket with the **service-role key** — this is the
   second legitimate reader of `SUPABASE_SERVICE_ROLE_KEY` in the codebase,
   alongside `sync-scryfall.ts`; see `.claude/rules/data-access.md`. Publishes
   to a content-addressed, versioned path (`v1/catalog-<sha256 prefix>.json`),
   never overwriting a fixed filename, so `EXPO_PUBLIC_CATALOG_URL` always
   names a specific build. The bucket itself is created once, by hand, via
   `scripts/create-catalog-bucket.ts` — a script, not a migration, because
   `npm run test:db` applies migrations to a Postgres with no `storage`
   schema at all.

`.github/workflows/scryfall-sync.yml` runs export → build → publish after
`sync:scryfall`, gated on that run having actually upserted something (an
unchanged day skips a ~30MB re-publish for nothing) — see the sync script's
`$GITHUB_OUTPUT` write and the workflow's own header comment.

### On the device: download, demo, and the size cap

- **A snapshot ships inside the app.** `npm run catalog:snapshot` (run it before
  a native build; `scripts/catalog-snapshot.sh`) exports + builds the catalog
  into `apps/mobile/assets/catalog-snapshot.db` (git-ignored, ~40 MB). On first
  launch `AppProvider` calls `installBundledCatalog` (`src/catalog.ts`), which
  unpacks it into the same two-slot store a download uses, so scanning works
  with no download. The `require` is optional: a build without the file still
  bundles and falls back to asking the user to download
  (`CatalogDownloadModal` in `App.tsx`: a yes/no ask that says why, a progress
  bar via `refreshCatalog`'s `onProgress`, and it closes itself when done;
  "Not now" lasts the session).
- **Updates.** The publish step writes a fixed `v1/latest.json` pointer
  (`{version, generatedAt, bytes, url}`) *after* each hashed catalog upload; the
  app derives its address from `EXPO_PUBLIC_CATALOG_URL` and checks it at most
  once a day (`src/catalogUpdates.ts`), offering "New cards are available.
  Update?" in the same window. "Later" is remembered per version; Settings has
  "Check for updates". Nothing downloads without the user saying yes. The
  pointer only exists after the next publish that follows this change.
- **`demo` is derived, not a setting:** `index.bundle.version === 'demo-only'`.
  In demo mode saves are simulated and never reach the database (the demo
  records are synthetic and must never reach Supabase). A configured install
  that is still on the demo bundle (first download failed) shows a "Card
  database not downloaded" screen with a retry button rather than scanning
  against demo data.
- **Size cap is 80 MB** (`limit` in `refreshCatalog`), enforced on
  `content-length` and again while streaming; the published bundle is ~40 MB.
  It was 40 MB and sat right at the ceiling.
- The bundle is parsed synchronously on the JS thread (`JSON.parse` in
  `loadCatalog`) at launch. Cost on a real phone is unmeasured.

### Printing-picker search: hints vs. a filter

`printingHints` (in `packages/scan-core/src/printing.ts`) produces the `hints`
below. `CardIndex.search` (`packages/scan-core/src/catalog.ts`) takes two different
kinds of set-code/collector-number input, and they behave differently on
purpose:

- **`hints`** (second parameter) only re-rank a candidate to
  `evidence: 'printing'`; they never exclude. This is what OCR output feeds
  in (`printingHints`, via `ScanPipeline`) — OCR misreads a set code often
  enough that hard-excluding on it would silently drop the correct card.
- **`filter`** (third parameter) actually excludes non-matching printings.
  This is what a person typing into the manual-search picker feeds in
  (`ManualAddSheet` in `apps/mobile/src/screens/ScanSessionSummary.tsx`, its set-code/collector-number fields, via `searchWithTotal`) — against a
  catalog where a name like "Lightning Bolt" has 100+ printings, ranking
  alone left `search` silently showing 50 of them with no way to reach the
  rest.

`CardIndex.searchWithTotal` returns `{ results, total }` — `total` is the
match count *before* truncation to `limit`, which is what lets the picker say
"50 of 118 matched" instead of a capped list with no indication more exist.
Both entry points share one private ranking pass (`CardIndex`'s `rank`
method); `search` is a thin slice of it kept for callers (`ScanPipeline`) that
only need the page, not the count.

`Printing.setName`/`releasedAt`/`rarity` are optional additions to the bundle
schema, still under `schemaVersion: 1` — an older cached bundle without them
stays valid, and the app falls back to a raw set code when `setName` is
absent.

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
  function both `apps/mobile/src/decks.ts`'s sleeve/unsleeve helpers (driven from
  `SleevePicker` in `apps/mobile/src/screens/DeckDetailScreen.tsx`, with the
  pending-move persistence and retry in `AppProvider`'s `beginMove`) and, eventually, a rewritten
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
replays itself automatically: `AppProvider`'s recovery effects surface a
recovered pending write (a legacy pending scan via `RecoveryPanel`, a pending
sleeve/unsleeve via the global banner) for an explicit retry/verify tap, and
sign-out clears both the persisted session and that account's pending-scan and
pending-move keys (`AppProvider`'s `onAuthStateChange` handler). The live
scanner's staged session list is never persisted at all — see "The live scanner". `signInWithPassword`
is the only auth path in this phase — OAuth and deep links do not exist. Sign-up, and password reset
(finished on the web page) and in-app account deletion are in `src/auth.ts`. The invite code is not enforced on mobile sign-up.
