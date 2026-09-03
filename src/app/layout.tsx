import type { Metadata, Viewport } from "next";
import "./globals.css";

import { ThemeScript } from "@/components/ThemeScript";

export const metadata: Metadata = {
  title: "MTGManager",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
