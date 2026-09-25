import { notFound } from "next/navigation";
import { PopoutBoard } from "@/components/playtester/PopoutBridge";
import { getCurrentUser } from "@/lib/supabase/server";

/** Owner-only live view. The browser channel transports a redacted projection. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Live playtest · Project Upkeep", robots: { index: false, follow: false } };
export default async function PopoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const user = await getCurrentUser(); if (!user) notFound();
  return <PopoutBoard deckId={id} userId={user.id} />;
}
