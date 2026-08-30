import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTGManager",
  description:
    "Track where every card in your Magic: The Gathering collection physically lives.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
