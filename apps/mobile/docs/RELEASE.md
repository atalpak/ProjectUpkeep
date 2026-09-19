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
- **Over-the-air updates.** `expo-updates` is not installed. `runtimeVersion`
  (policy `appVersion`) is set so it can be added later without a rebuild
  scheme change.

## Crash reporting (Sentry)

Approved and wired, off until a DSN is supplied. `reportError` in
`src/errors.ts` is the single hook; `src/crashReporting.ts` holds the init and
the privacy scrubbing (no user, no breadcrumbs, no request data, emails masked).

- **Needs a native rebuild.** `@sentry/react-native` is a native module and the
  app.json plugin edits the native projects, so the next dev-client/EAS build
  after this change must be a full rebuild, not a JS reload.
- **Turn it on:** create a React Native project in Sentry, copy its DSN, set
  `EXPO_PUBLIC_SENTRY_DSN` in `apps/mobile/.env` (local) or as an EAS
  environment variable / secret for the build profile, then rebuild. No DSN, no
  reporting: nothing is initialised.
- **Source maps are not uploaded.** The plugin adds Xcode build steps that
  upload source maps and would fail the build without `SENTRY_AUTH_TOKEN`, org
  and project. Every profile in `eas.json` therefore sets
  `SENTRY_DISABLE_AUTO_UPLOAD=true`. For a local `expo run:ios`, export the
  same variable, or the build fails. Reports still arrive, with unsymbolicated
  JS stack traces. To get readable stacks later, unset that variable and provide
  `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` as EAS secrets.
- The bundle id is unchanged.

## Local rebuild with Sentry

The existing gitignored `ios/` folder will not pick up the Sentry Xcode phases unless you re-run `npx expo prebuild -p ios`. Export `SENTRY_DISABLE_AUTO_UPLOAD=true` in the same shell before `npx expo run:ios` (Debug builds probably skip the upload anyway; Release builds need it). Restart Metro with `-c` after adding a DSN so it is inlined.
