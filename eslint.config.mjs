import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * eslint-config-next 16 ships native flat configs, so these are spread in
 * directly rather than wrapped in FlatCompat (which cannot serialise the
 * plugin graph and throws).
 *
 * Two worlds, one file. The Next presets know nothing about React Native
 * (their `@next/next` rules are about <img>/<Link>/pages), so they are fenced
 * off from the Expo workspace and packages; the workspace gets its own small
 * block below instead of inheriting rules that cannot apply.
 */
const MOBILE_GLOBS = ["apps/**", "packages/**"];

// Config objects that only carry `ignores` are *global* ignores; adding
// `ignores` to them would turn them into per-file ones, so leave those alone.
const fenceOffMobile = (configs) =>
  configs.map((c) =>
    Object.keys(c).every((k) => k === "ignores" || k === "name")
      ? c
      : { ...c, ignores: [...(c.ignores ?? []), ...MOBILE_GLOBS] },
  );

// Direct database drivers and query builders: one import from a bundle away
// from a connection string being usable there. Exact names; see the ban below.
const DB_DRIVERS = [
  "postgres",
  "pg",
  "pg-pool",
  "pg-native",
  "pg-cursor",
  "pg-query-stream",
  "pg-copy-streams",
  "slonik",
  "kysely",
  "knex",
  "drizzle-orm",
  "postgres-js",
  "@vercel/postgres",
  "@neondatabase/serverless",
  "@electric-sql/pglite",
];
const DRIVER_MESSAGE =
  "A direct Postgres driver belongs in the repo-root scripts/ only (CLAUDE.md hard constraint 4): its connection string is as powerful as the service key.";

const FRAMEWORK_MESSAGE =
  "src/lib/playtest is framework-free: no React, Next, Supabase or UI imports. The core has to run under plain tsx and stay reusable.";
const COLLECTION_MESSAGE =
  "Playing never touches the collection: the playtester may not import collection or deck-management code at runtime (type-only imports are fine).";
const APP_IMPORT_MESSAGE =
  "The play UI receives server actions as props from page.tsx; it never imports from @/app/** (type-only imports excepted).";
const NONDETERMINISM_MESSAGE =
  "The game core must be deterministic: decide the random value / id / timestamp BEFORE the command and carry it on the command.";

// The credential-name bans from hard constraint 4, as data: flat config makes
// a later block that sets `no-restricted-syntax` REPLACE the earlier one for
// its files, so every block that adds its own syntax rules (the playtester
// fences below) must spread these back in or it silently un-bans them.
const SCRYFALL_SYNTAX = [
  {
    // Exact names only: esquery cannot take these names inside a regex
    // (the `/` in "@vercel/postgres" ends it), and a sub-path require
    // is not a shape this codebase uses.
    selector: `CallExpression[callee.name='require']:matches(${DB_DRIVERS.map((n) => `[arguments.0.value='${n}']`).join(", ")})`,
    message: DRIVER_MESSAGE,
  },
  {
    selector: "Identifier[name=/^SCRYFALL_SYNC_DATABASE_/]",
    message:
      "SCRYFALL_SYNC_DATABASE_* is the loader's database credential: read it in the repo-root scripts/ only (CLAUDE.md hard constraint 4).",
  },
  {
    selector: "Literal[value=/SCRYFALL_SYNC_DATABASE_/]",
    message:
      "SCRYFALL_SYNC_DATABASE_* is the loader's database credential: read it in the repo-root scripts/ only (CLAUDE.md hard constraint 4).",
  },
  {
    selector: "TemplateElement[value.raw=/SCRYFALL_SYNC_DATABASE_/]",
    message:
      "SCRYFALL_SYNC_DATABASE_* is the loader's database credential: read it in the repo-root scripts/ only (CLAUDE.md hard constraint 4).",
  },
];

const eslintConfig = [
  {
    // ios/android are generated native projects (Pods, Gradle output).
    ignores: [
      ".next/**", "node_modules/**", "next-env.d.ts", "supabase/**",
      "apps/**/node_modules/**", "apps/mobile/ios/**", "apps/mobile/android/**",
      "packages/**/node_modules/**", "packages/upkeep-vision/ios/**", "packages/upkeep-vision/android/**",
    ],
  },
  ...fenceOffMobile([...nextCoreWebVitals, ...nextTypescript]),
  // Expo/RN workspace and packages: TypeScript recommended + the hooks rules.
  // Deliberately no type-aware rules — `tsc --strict` already runs in CI, and
  // type-aware linting would need a parserOptions.project per workspace.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: c.files ?? ["**/*.{ts,tsx,mts,cts}"] })).map((c) => ({
    ...c,
    files: (c.files ?? []).flatMap((f) => MOBILE_GLOBS.map((g) => `${g}/${f}`)),
  })),
  {
    files: MOBILE_GLOBS.map((g) => `${g}/**/*.{ts,tsx}`),
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { __DEV__: "readonly" } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Metro resolves static assets (images, fonts, JSON) only through a literal
    // `require('./x.png')`; there is no ES-import form that yields a bundler
    // asset id. So this rule cannot apply to the app. It stays on for the
    // framework-free packages, which have no such need.
    files: ["apps/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Hard constraint 4 (CLAUDE.md), second half. The Scryfall loader connects
    // to Postgres directly as a purpose-made role, and its connection string is
    // as powerful as that role: it must exist only in the repo-root scripts/,
    // outside every bundle. The service-role key is contained by where it is
    // read; this makes the same containment mechanical for the connection
    // string, because a Postgres driver imported anywhere under src/, apps/ or
    // packages/ is one import away from a browser or app bundle. Two bans: the
    // drivers themselves, and the variable's name (any SCRYFALL_SYNC_DATABASE_*,
    // which also covers its CA companion). scripts/ is deliberately not listed.
    // Add a legitimate reader to scripts/, not an exception here.
    files: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", ...MOBILE_GLOBS.map((g) => `${g}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`)],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // Exact package names, NOT globs: a `pg-*` glob also matches our own
          // relative './pg-copy' module (a pure text encoder that must stay
          // importable from src/lib), so every driver is named. Sub-paths are
          // covered separately. A driver not on this list is not banned: add it
          // here when one is introduced under scripts/.
          paths: DB_DRIVERS.map((name) => ({ name, message: DRIVER_MESSAGE })),
          patterns: [
            { group: DB_DRIVERS.map((name) => `${name}/*`), message: DRIVER_MESSAGE },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...SCRYFALL_SYNTAX],
    },
  },

  // ---------------------------------------------------------------------------
  // Playtester fences. "Playing never writes the collection" (the Play guide,
  // section 1) is a promise about three layers, and each gets a mechanical
  // guard instead of a convention:
  //   A  src/lib/playtest/**   framework-free: the pure core must stay
  //      runnable under plain `tsx` and reusable by a future native client.
  //   B  the UI and the route  cannot reach the collection-writing code.
  //   scripts/playtest-boundary.test.ts  is the backstop for the server
  //      actions, which may not name a table outside the playtest ones.
  //
  // Flat-config trap, written down because it already bit once in this file:
  // a later block that sets `no-restricted-imports` / `no-restricted-syntax`
  // for a file REPLACES the earlier setting, it does not merge. So every
  // block below re-spreads DB_DRIVERS and SCRYFALL_SYNTAX; leave either out
  // and hard constraint 4's bans quietly stop applying to these paths.
  // Type-only imports are allowed where noted (`import type` is erased at
  // compile time, so it cannot drag runtime code across a boundary), which
  // is why the typescript-eslint version of the rule is used: the core one
  // cannot express that. Do not put `[id]` in a glob: it is a character set.
  // ---------------------------------------------------------------------------
  {
    files: ["src/lib/playtest/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            ...DB_DRIVERS.map((name) => ({ name, message: DRIVER_MESSAGE })),
            ...["react", "react-dom", "next"].map((name) => ({ name, message: FRAMEWORK_MESSAGE })),
          ],
          patterns: [
            { group: DB_DRIVERS.map((name) => `${name}/*`), message: DRIVER_MESSAGE },
            { group: ["react/*", "react-dom/*", "next/*", "@supabase/*"], message: FRAMEWORK_MESSAGE },
            { group: ["@/lib/supabase", "@/lib/supabase/*"], message: FRAMEWORK_MESSAGE },
            { group: ["@/app/*", "@/components/*", "@/hooks/*"], message: FRAMEWORK_MESSAGE },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...SCRYFALL_SYNTAX],
    },
  },
  {
    // The pure game core. Same bans as above plus the collection code (the
    // older analyzer files in this folder legitimately read
    // collection/availability and deck-view at runtime, so the collection ban
    // is scoped to the new core rather than the whole folder).
    files: [
      "src/lib/playtest/board/**/*.ts",
      "src/lib/playtest/opponent/**/*.ts",
      "src/lib/playtest/game-start.ts",
      "src/lib/playtest/recovery.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            ...DB_DRIVERS.map((name) => ({ name, message: DRIVER_MESSAGE })),
            ...["react", "react-dom", "next"].map((name) => ({ name, message: FRAMEWORK_MESSAGE })),
          ],
          patterns: [
            { group: DB_DRIVERS.map((name) => `${name}/*`), message: DRIVER_MESSAGE },
            { group: ["react/*", "react-dom/*", "next/*", "@supabase/*"], message: FRAMEWORK_MESSAGE },
            { group: ["@/lib/supabase", "@/lib/supabase/*"], message: FRAMEWORK_MESSAGE },
            { group: ["@/app/*", "@/components/*", "@/hooks/*"], message: FRAMEWORK_MESSAGE },
            { group: ["@/lib/collection/*"], message: COLLECTION_MESSAGE, allowTypeImports: true },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...SCRYFALL_SYNTAX],
    },
  },
  {
    // board/ and opponent/ only: the three sources of nondeterminism.
    // Randomness is decided BEFORE a command and carried on it; a Math.random
    // inside the reducer would make "same seed, same commands, same state"
    // a lie.
    files: ["src/lib/playtest/board/**/*.ts", "src/lib/playtest/opponent/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: NONDETERMINISM_MESSAGE },
        { object: "Date", property: "now", message: NONDETERMINISM_MESSAGE },
        { object: "crypto", property: "randomUUID", message: NONDETERMINISM_MESSAGE },
      ],
    },
  },
  {
    // The UI and the play route folders: nothing here may import the deck
    // manager, the importer, or (at runtime) the collection queries. The
    // route's page.tsx is carved out below because it is the one place that
    // reads the deck list, through getDeck/getDeckList.
    files: [
      "src/components/playtester/**/*.{ts,tsx}",
      "src/app/(app)/decks/*/play/**/*.{ts,tsx}",
      "src/app/(app)/shared/playtest/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: DB_DRIVERS.map((name) => ({ name, message: DRIVER_MESSAGE })),
          patterns: [
            { group: DB_DRIVERS.map((name) => `${name}/*`), message: DRIVER_MESSAGE },
            { group: ["@/app/*"], message: APP_IMPORT_MESSAGE, allowTypeImports: true },
            { group: ["@/components/decks/*", "@/lib/import/*"], message: COLLECTION_MESSAGE },
            { group: ["@/lib/collection/*"], message: COLLECTION_MESSAGE, allowTypeImports: true },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...SCRYFALL_SYNTAX],
    },
  },
  {
    files: ["src/app/(app)/decks/*/play/page.tsx", "src/app/(app)/shared/playtest/**/page.tsx"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: DB_DRIVERS.map((name) => ({ name, message: DRIVER_MESSAGE })),
          patterns: [
            { group: DB_DRIVERS.map((name) => `${name}/*`), message: DRIVER_MESSAGE },
            { group: ["@/components/decks/*", "@/lib/import/*"], message: COLLECTION_MESSAGE },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...SCRYFALL_SYNTAX],
    },
  },
];

export default eslintConfig;
