# Project Upkeep — mobile scanner, phase one

This workspace now contains the first **React Native / Expo mobile client** for Project Upkeep and reusable scanning packages. The original Flutter application remains intact as a reference. Start new development in `apps/mobile`, not `lib/`.

## Run the mobile app

Use Node 22 LTS or newer, npm, Xcode for iOS, and Android Studio with JDK 17+ for Android.

```sh
npm ci
npm test
npm run typecheck
cd apps/mobile
npx expo run:ios
# Or: npx expo run:android
```

Subsequent launches: `npm run mobile` from the workspace root. A native development build is required for OCR; Expo Go cannot load our custom module. The demo catalog contains **three synthetic printing records**, and demo additions only live in the current session. Search for “Lightning Bolt” or “Sol Ring” to exercise the confirmation flow.

To connect your existing Upkeep backend, follow [the migration guide](docs/MIGRATION.md). No production credentials, database migrations, or changes to the separate web checkout were made. The connected adapter uses the user's ordinary Supabase session and `card_instances` RLS. It saves one row per confirmed scan; web-style stack consolidation is a documented follow-up.

## What's here

| Path | Purpose |
| --- | --- |
| `apps/mobile` | Upkeep-branded camera, search, review, account sign-in, catalog refresh, collection save |
| `packages/scan-core` | Framework-independent TypeScript matching, validation, pipeline, write/retry contracts and tests |
| `packages/upkeep-vision` | Expo native module: Apple Vision OCR / artwork comparison, Android ML Kit OCR |
| `scripts` | Catalog exporter input contract, bundle builder, synthetic performance benchmark |
| `lib`, `ios`, `android`, `macos`, `test` | Original Flutter implementation; reference only |

## Read next

- [Developer handoff and ordered next steps](docs/HANDOFF.md)
- [Upkeep migration and data contracts](docs/MIGRATION.md)
- [Architecture and inherited asset findings](docs/ARCHITECTURE.md)
- [Reliability / performance review](docs/QUALITY_REVIEW.md)
- [Validation results and device acceptance checklist](docs/VALIDATION.md)

The app is a phase-one foundation, not a production-validated scanner. Physical camera accuracy, live account/RLS integration, and real-catalog memory measurements remain release gates. The native artwork comparator is available for integration but intentionally not enabled in the screen until its ranking is calibrated with real cards. OCR failure currently leads to manual search; there is no hidden global image classifier.
