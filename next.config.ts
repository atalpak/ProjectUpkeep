import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
