import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships native flat configs, so these are spread in
 * directly rather than wrapped in FlatCompat (which cannot serialise the
 * plugin graph and throws).
 */
const eslintConfig = [
  {
    // apps/** are the Expo/React Native workspace (see .claude/rules/mobile.md)
    // — a different toolchain (eslint-config-next does not understand RN/Expo
    // globals) with its own lint setup, not this one's job to cover.
    // packages/** includes both the RN-facing packages (scan-core, vision) and
    // @upkeep/domain, which the web app now imports (src/lib/collection/stacking.ts)
    // — it stays excluded here anyway because it has its own tsconfig/test setup,
    // the same as scan-core; see the mobile CI job for where it gets
    // typechecked and tested (it has no eslint config of its own).
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "supabase/**", "apps/**", "packages/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
