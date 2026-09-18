# Developer handoff — Project Upkeep mobile, phase one

## Current state (2026-09-18)

The rest of this file is the **2026-09-16 phase-one handoff**, kept as history. For the current
state read [`.claude/rules/mobile.md`](../../../.claude/rules/mobile.md). Superseded passages below:
"Implemented" (single-file `App.tsx`, manual still capture, Refresh button, one row per scan),
"Files most likely to change next" (camera/review UX is now `src/screens/ScanScreen.tsx`,
`ScanSessionSummary.tsx`, and the native view in `packages/upkeep-vision/ios/`), and several of the
"next tasks" (collection/deck browsing, sleeve/unsleeve, stack-merging writes and the set/collector
picker have shipped).

What exists now: a four-tab app with an iOS-only live scanner (`UpkeepScannerView`, ported from the
Flutter scanner at `/Users/anthonytalpak/MTGCardScanner`), a stage-then-commit add flow, and
first-launch catalog download.

**Building and running** (details and the reasons in `mobile.md`):

```sh
cd apps/mobile
# Any native-module change needs a full rebuild. LANG matters: CocoaPods crashes with an
# ASCII-8BIT encoding error without it. Use the device UDID (xcrun xctrace list devices), not its name.
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device <UDID>
# JS-only changes reload through the running Metro server (npm run start -w @upkeep/scanner-app).
xcrun devicectl device process launch --device <coredevice id> --terminate-existing dev.projectupkeep.scanner
```

The iOS Simulator has no camera and cannot exercise scanning.

**Open items:** alternate-art printing accuracy
([`SCANNER_ALTERNATE_ART_PLAN.md`](SCANNER_ALTERNATE_ART_PLAN.md), deferred); live scanning on
Android; no prices in the mobile session list; mobile bulk commit is sequential per card (an impact
map recommends caching the user id and prefetching merge targets before any batch RPC); no
automated tests over mobile screens; the 40 MB catalog is parsed synchronously on the JS thread at
launch (unmeasured). Brand fonts differ from the web app (mobile: Cinzel / Plus Jakarta Sans; web:
Fraunces / Inter).

Historical record follows.

## Start here

Read `README.md`, then `docs/MIGRATION.md`. The owner clarified there is no existing React Native app: the mobile client built here is the starting point. The acquired Flutter code is retained for reference and its original UI is not the migration target.

This directory initially had **no Git repository**. No commit or PR was created. Put the source and lockfile under your chosen repository before continuing; do not commit `node_modules`, generated native directories, credentials, or build output.

## Implemented

- Expo SDK 55 / React Native 0.83 app with an Upkeep parchment/amber/green palette, Cinzel heading, and selected Plus Jakarta Sans fonts.
- Camera permission flow, background lifecycle handling, manual still capture, temporary photo cleanup, manual text search, exact-printing selection, and explicit physical-copy details.
- Local on-device OCR: Apple Vision iOS module and bundled ML Kit Latin text recognition Android module.
- Portable TypeScript name/alias index with fuzzy matching, validation, fallback interfaces, cancellation/single-flight behavior, and privacy-minimal optional telemetry callback.
- Two-slot catalog cache, version validation, streaming download deadline/size cap, and a JSONL-to-bundle build command for the existing catalog sync.
- Optional Supabase email/password sign-in, owned-location loading, RLS-scoped collection insert, duplicate-tap coalescing, and operation-ID-based uncertain-write recovery.
- Account-scoped pending confirmation in SecureStore. Auth now persists across restarts (phase 1b), so recovery after restart no longer requires signing in again — but the recovered save still surfaces for an explicit retry/verify tap rather than resubmitting itself.
- Demo mode with three explicitly synthetic printings. No backend settings or live account are needed to try the review flow.
- Original iOS artwork comparison logic reimplemented as an optional native primitive. It is **not enabled in the screen**, not globally identifying cards, and not calibrated as proof of identity.

## Highest-priority next tasks

1. **Connect a development Upkeep backend and real catalog.** Use `docs/MIGRATION.md`; verify scanned printing/finish/condition/quantity/location in the web collection. Test RLS with two accounts. The existing web checkout was not modified and no database migration was applied.
2. **Run the physical-device matrix in `docs/VALIDATION.md`.** Save labeled test captures only with an intentional privacy decision. Report top-1 name accuracy, printing accuracy after review, no-match rate, false positives, P50/P95 capture-to-review time, peak memory, and battery impact. Keep foil/etched/sleeved/alternate-art/non-English cohorts separate.
3. **Unify collection mutation logic.** Mobile currently appends one row per scan; web merges matching stacks. Extract a shared authenticated service with transactional increments and durable operation deduplication before promising identical behavior. Preserve the existing stacking policy and RLS.
4. **Measure a real production catalog on the minimum phone.** Current parsing/index construction is on JS and can cause a visible pause. If necessary, split a compact name-only index from paged printing details or move the index into SQLite/native code. Add a set/collector-number picker to reach all printings beyond the 50-result cap.
5. **Integrate optional artwork ranking.** `compareArtwork(uri, localReferenceUris)` is available on iOS. Build a small download/cache adapter with a total deadline, byte limits, bounded concurrency and disk eviction, then connect `ScanPipeline.comparePrintings`. Do not enable it until identical-art/border variants are represented in tests. Android currently reports artwork comparison unavailable; manual review remains required.
6. **Complete the mobile product shell.** Password reset/OAuth deep links, collection/deck browsing, sorting/moving, and normal navigation are outside this scan-first phase (persistent auth itself shipped in phase 1b). Reuse existing backend models and business rules instead of creating another source of truth.
7. **Resolve pending-write conflicts deliberately.** If a submitted row was edited/deleted on web, or its location is no longer writable, verification fails closed. Design a server-supported reconciliation path; do not simply issue another operation ID.
8. **Release hardening.** App icon/real identifiers, signing, store privacy declarations, localization, full accessibility and Dynamic Type QA, crash reporting with no OCR/photo contents, CI and release builds. No store deployment has been performed.

## Files most likely to change next

| Work | Entry point |
| --- | --- |
| Camera/review UX | `apps/mobile/App.tsx` |
| Supabase integration | `apps/mobile/src/backend.ts` |
| Catalog transport/cache | `apps/mobile/src/catalog.ts` |
| Recognition thresholds and ranking | `packages/scan-core/src/catalog.ts`, `pipeline.ts` |
| Collection invariants/retries | `packages/scan-core/src/collection.ts`, `writer.ts` |
| iOS recognition | `packages/upkeep-vision/ios/UpkeepVisionModule.swift` |
| Android recognition | `packages/upkeep-vision/android/src/main/java/expo/modules/upkeepvision/UpkeepVisionModule.kt` |
| Daily bundle generation | `scripts/export-catalog.sql`, `scripts/build-catalog.ts` |

## Commands and build notes

```sh
npm ci
npm run typecheck
npm test
npm run bench
cd apps/mobile
npx expo install --check
npx expo run:ios
npx expo run:android
```

Run native commands from `apps/mobile`, not the Flutter root. The native Expo library is autolinked through `@upkeep/vision`. Use a development build rather than Expo Go. Generated iOS/Android projects are ignored and can be recreated; reusable native source lives in `packages/upkeep-vision`.

An upstream React Native 0.83 Gradle plugin pins Foojay 0.5.0, which fails with Gradle 9 (`IBM_SEMERU`). The root `postinstall` runs `scripts/patch-native-toolchain.cjs`, replacing that exact pin with 1.0.0. Review/remove this small patch when the upstream backport lands. [Upstream tracking](https://github.com/reactwg/react-native-releases/issues/1349).

On this Mac, Flutter is installed at `/opt/homebrew/share/flutter/bin/flutter`, and Android Studio's bundled Java is at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`. These are environment-specific paths, not application dependencies. Prefer JDK 17 in CI.

Review `docs/VALIDATION.md` for the actual verification results; do not turn the checklist into claimed completed work.
