import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Generated rather than a static file so the mark and palette stay in sync
 * with Wordmark.tsx by hand rather than by keeping two asset pipelines
 * aligned. Colors are the same fixed brand values as the mark (see
 * Wordmark.tsx) — this file predates any real screenshot to show instead.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F6EFDE",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="140" height="140" viewBox="0 0 64 64">
            <rect x="6" y="4" width="44" height="56" rx="9" fill="#D98A2C" />
            <rect x="14" y="14" width="28" height="18" rx="3" fill="#FCF8EE" />
            <rect x="14" y="38" width="28" height="4" rx="2" fill="#FCF8EE" opacity={0.85} />
            <rect x="14" y="46" width="19" height="4" rx="2" fill="#FCF8EE" opacity={0.6} />
            <circle cx="48" cy="50" r="13" fill="#2F6B4F" />
            <path
              d="M42.5 50 l4.2 4.2 l8.5 -9.4"
              stroke="#FCF8EE"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700 }}>
            <span style={{ color: "#26291F" }}>Project</span>
            <span style={{ color: "#D98A2C" }}>Upkeep</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
