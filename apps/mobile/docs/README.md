# Project Upkeep — mobile scanner, phase one

> **Historical (2026-09-16) except where corrected below.** The current description of the mobile
> app is [`.claude/rules/mobile.md`](../../../.claude/rules/mobile.md). Since this was written the app
> gained a four-tab shell and an iOS-only live scanner; see the "Current state (2026-09-18)"
> sections in [ARCHITECTURE.md](ARCHITECTURE.md) and [HANDOFF.md](HANDOFF.md).

This workspace now contains the first **React Native / Expo mobile client** for Project Upkeep and reusable scanning packages. The original Flutter application is **not in this repository**; it lives separately at `/Users/anthonytalpak/MTGCardScanner` and is the behavioural reference for the live scanner. Develop in `apps/mobile` and `packages/*`.

## Run the mobile app

Use Node 22 LTS or newer, npm, Xcode for iOS, and Android Studio with JDK 17+ for Android.

```sh
npm ci
npm test -w @upkeep/scan-core
npm run typecheck -w @upkeep/scanner-app
cd apps/mobile
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device <UDID>   # or: npx expo run:android
```

Subsequent JS-only launches: `npm run start -w @upkeep/scanner-app` (Metro) from the repo root; a change to any native module needs the full `expo run:ios` rebuild again. A native development build is required for OCR; Expo Go cannot load our custom module, and the iOS Simulator has no camera. Live scanning is iOS only. With no backend configured the app runs on a **three-record synthetic demo catalog** and demo additions only live in the current session; with a backend configured the real catalog downloads on first launch. (The root `npm test` / `npm run typecheck` cover only the Next.js app, not the workspaces.)

To connect your existing Upkeep backend, follow [the migration guide](docs/MIGRATION.md). No production credentials, database migrations, or changes to the separate web checkout were made. The connected adapter uses the user's ordinary Supabase session. Adds go through the atomic `apply_stack_addition` function (migration 36), which merges into an existing stack; this superseded the original one-row-per-scan behaviour.

## What's here

| Path | Purpose |
| --- | --- |
| `apps/mobile` | Expo app: tabbed shell, live scanner UI, session review, collection and deck browsing, account, catalog download |
| `packages/scan-core` | Framework-independent TypeScript matching, validation, pipeline, write/retry contracts and tests; also `packages/scan-core/scripts` (catalog builder, benchmark, toolchain patch) |
| `packages/upkeep-domain` | Pure TS shared with the web app: stacking policy and card vocabulary |
| `packages/upkeep-vision` | Expo native module: iOS live scanner view (AVFoundation + Apple Vision), photo OCR (Apple Vision / Android ML Kit), iOS artwork comparison |
| `scripts` (repo root) | `export-catalog.ts`, `publish-catalog.ts`, `create-catalog-bucket.ts` alongside the web app's scripts |

## Read next

- [Developer handoff and ordered next steps](docs/HANDOFF.md)
- [Upkeep migration and data contracts](docs/MIGRATION.md)
- [Architecture and inherited asset findings](docs/ARCHITECTURE.md)
- [Reliability / performance review](docs/QUALITY_REVIEW.md)
- [Validation results and device acceptance checklist](docs/VALIDATION.md)

The app is a phase-one foundation, not a production-validated scanner. Physical camera accuracy, live account/RLS integration, and real-catalog memory measurements remain release gates. The native artwork comparator is available for integration but intentionally not enabled in the screen until its ranking is calibrated with real cards. OCR failure currently leads to manual search; there is no hidden global image classifier.
