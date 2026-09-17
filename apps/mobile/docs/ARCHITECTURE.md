# Architecture and due diligence

## Scope decision — 2026-09-16

The owner clarified that Project Upkeep currently has a **Next.js web app only**. This is the first mobile phase. The attached architecture document was treated as planning context, with its assumptions checked against source code. It was not used as authorization to publish, replace the web app, or modify a live database.

The implementation uses Expo SDK 55 / React Native 0.83, TypeScript, and an Expo Modules native library. Keeping the core package free of React/Expo imports lets it move into a future Upkeep monorepo or run in the web app. Expo native modules can also be consumed by a bare React Native app after installing Expo modules support.

## What the acquired app actually contains

| Question | Finding from source |
| --- | --- |
| On-device or API image matching? | Apple Vision `VNGenerateImageFeaturePrintRequest`; comparison is on-device, reference pictures downloaded from Scryfall. |
| Custom trained assets? | None found. `assets/` contains a confirmation sound, not a model or reference embedding corpus. |
| What is compared? | Up to 16 printings of a title already found by OCR. The captured rectangle is compared with full-card reference images. |
| Confidence? | Best feature-print distance must be < 90% of runner-up distance; no absolute-distance calibration. This is a ranking heuristic, not a probability. |
| Fallback trigger? | Artwork refines an already-recognized title. It cannot recover from completely missing OCR. |
| Backend? | Direct Scryfall requests plus local JSON files. No private recognition API, auth system, or collection backend found. |
| Android parity? | Original `MainActivity.kt` handles `detectCard` only. OCR/artwork methods return not implemented. New Android module adds bundled Latin-script ML Kit recognition. |
| Measured accuracy? | No labeled image corpus, precision/recall study, or foil/non-English benchmark found. Do not claim an accuracy percentage. |

Primary source paths: `ios/Runner/AppDelegate.swift`, `lib/src/recognition/data/card_text_reader.dart`, `lib/src/scanner/presentation/scanner_screen.dart`, and `android/app/src/main/kotlin/com/mtgscanner/mtg_card_scanner/MainActivity.kt`.

## Data flow

```mermaid
flowchart TD
  Camera[Expo Camera still photo] --> OCR[Vision iOS / ML Kit Android]
  OCR --> Index[Local TypeScript name + alias index]
  Search[Manual name search] --> Index
  Index --> Review[Choose exact printing]
  Review --> Details[Confirm finish / condition / language / quantity / location]
  Details --> Pending[Persist operation ID and payload in SecureStore]
  Pending --> Auth[Current authenticated Supabase user]
  Auth --> Insert[INSERT card_instances under existing RLS]
  Insert --> Recover[On uncertain response: verify same row ID + all fields]
  Recover --> Clear[Clear pending save after confirmed success]
```

The scan-core pipeline also exposes `identifyImage` for a future global image model/service and `comparePrintings` for candidate refinement. Neither is secretly enabled; no captured image leaves the device in this build. `@upkeep/vision.compareArtwork` only accepts local reference files, with a 16-image limit. The app currently uses OCR + manual review. Integrating reference downloading is a separate, explicit next step.

## Safety and lifecycle properties

- Capture is manual and single-flight. No continuous camera frames cross the JS bridge.
- Backgrounding closes the camera and invalidates pending recognition results.
- Cancelling JS work does not release the native lock early; the owned temporary photo is deleted only after native OCR settles.
- All matches require review. Name equality never implies a particular printing, finish, or condition.
- Catalog names include Unicode normalization and aliases; Latin ML Kit does not imply support for recognizing Japanese/Chinese text.
- Catalog refresh uses a byte budget, request deadline, schema validation, and two alternating disk slots. A partial new slot leaves the previous valid slot available.
- In-progress collection save data is scoped to the signed-in user and retained across process death. No automatic background replay occurs: a pending save recovered after restart is shown for an explicit retry/verify tap, never resubmitted silently.
- Auth persists across restarts (phase 1, part b) via a SecureStore-backed `auth.storage` adapter in `src/backend.ts` — see the comment there for why the session blob's size is not a problem on this SDK version. Signing out clears both the persisted session and that account's pending-scan key. `signInWithPassword` is still the only auth path; password reset, OAuth, deep links and registration remain future mobile-shell work. No service-role key is used.

## SDK sources checked during implementation

- [Expo local native modules](https://docs.expo.dev/modules/get-started/)
- [Expo module API](https://docs.expo.dev/modules/module-api/)
- [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/)
- [ML Kit Android text recognition](https://developers.google.com/ml-kit/vision/text-recognition/v2/android)

Actual dependency compatibility was checked against the installed Expo SDK's `bundledNativeModules.json`, not assumed from the planning document.
