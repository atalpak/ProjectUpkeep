import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships native flat configs, so these are spread in
 * directly rather than wrapped in FlatCompat (which cannot serialise the
 * plugin graph and throws).
 */
const eslintConfig = [
  {
    // apps/** and packages/** are the Expo/React Native workspaces (see
    // .claude/rules/mobile.md) — a different toolchain (eslint-config-next
    // does not understand RN/Expo globals) with their own lint setup, not
    // this one's job to cover.
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "supabase/**", "apps/**", "packages/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
