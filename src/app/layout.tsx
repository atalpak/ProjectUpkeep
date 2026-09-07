import type { Metadata, Viewport } from "next";
import { Baloo_2, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

import { cx } from "@/components/ui";
import { ThemeScript } from "@/components/ThemeScript";

// Rounded, game-box display face for headings and the wordmark — paired with
// a clean, dense body face for tables and data. The pairing is the point: no
// default stack lands on this combination, which is half of what makes an
// app read as considered rather than generated.
const display = Baloo_2({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  // Without this, Next resolves the opengraph-image route's URL against
  // localhost even in production, and social previews break.
  metadataBase: new URL("https://project-upkeep.vercel.app"),
  title: "Project Upkeep",
  description:
    "Track where every card in your Magic: The Gathering collection physically lives.",
};

// Explicit rather than relying on the framework default, and deliberately
// without maximumScale/userScalable: pinch-zoom is an accessibility feature and
// this app shows card images people will want to enlarge.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: ThemeScript adds `class="dark"` to <html>
    // before React hydrates, so the server and client markup differ here by
    // design. It is scoped to this element only.
    <html
      lang="en"
      suppressHydrationWarning
      className={cx(display.variable, body.variable)}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
