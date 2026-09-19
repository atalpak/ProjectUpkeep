# Release checklist (iOS)

Build profiles live in `apps/mobile/eas.json`: `development` (dev client),
`preview` (internal testing), `production`. No secrets are in that file.

Before every release build:

1. `npm run catalog:snapshot` (repo root) so the app ships with a current card
   database. Without it the build still works but asks the user to download.
2. `npm run typecheck -w @upkeep/scanner-app`.

Owner decisions still open (nothing here is configured until they are made):

- **Apple developer account** and the final **bundle id** (still the
  prototype's `dev.projectupkeep.scanner`).
- **Crash reporting vendor.** `reportError` in `src/errors.ts` is the single
  hook; it only logs to the console today.
- **Over-the-air updates.** `expo-updates` is not installed. `runtimeVersion`
  (policy `appVersion`) is set so it can be added later without a rebuild
  scheme change.
