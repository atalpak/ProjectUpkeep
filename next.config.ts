import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @upkeep/domain (packages/upkeep-domain) ships raw TypeScript with no build
  // step, the same as the mobile-only workspace packages — Metro transpiles
  // those for Expo, but Next's own bundler only transpiles files under src/
  // by default. Phase 3a is the first time web code imports a workspace
  // package (src/lib/collection/stacking.ts), so this is the first time that
  // gap matters here.
  transpilePackages: ["@upkeep/domain"],
  images: {
    // Scryfall serves and permits hot-linking/caching of card images, so we
    // point Next's optimizer at their CDN rather than re-hosting art ourselves.
    remotePatterns: [
      { protocol: "https", hostname: "cards.scryfall.io" },
      { protocol: "https", hostname: "svgs.scryfall.io" },
    ],
  },
};

export default nextConfig;
