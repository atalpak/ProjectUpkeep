import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

import { cx } from "@/components/ui";
import { ThemeScript } from "@/components/ThemeScript";

// The brand pairing: Fraunces for brand voice (marketing, Mort's lines,
// milestone moments — see `.font-brand` in globals.css) and Inter, a clean,
// dense grotesk, for the product itself (`.font-display`, despite the name,
// is product chrome — see that class's own comment). Both self-hosted via
// next/font, so there is no external request and no layout shift.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["SOFT", "WONK", "opsz"],
});

const body = Inter({
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
