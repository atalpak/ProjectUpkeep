import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships native flat configs, so these are spread in
 * directly rather than wrapped in FlatCompat (which cannot serialise the
 * plugin graph and throws).
 */
const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "supabase/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
