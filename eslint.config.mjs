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
      "no-restricted-syntax": [
        "error",
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
      ],
    },
  },
];

export default eslintConfig;
