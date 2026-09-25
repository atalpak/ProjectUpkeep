import { notFound } from "next/navigation";
import { PublicBoard } from "@/components/playtester/PublicBoard";
import { readProjection } from "@/lib/playtest/board/share";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/** Signed-in link holders only. The RPC returns a redacted projection, never a game snapshot. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Shared playtest · Project Upkeep", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function SharedPlaytestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!await getCurrentUser() || !/^[0-9a-f]{32}$/.test(token)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_playtest_share", { p_token: token });
  if (error || !data || typeof data !== "object") notFound();
  const row = data as { title?: unknown; projection?: unknown };
  const projection = readProjection(row.projection);
  if (!projection || typeof row.title !== "string") notFound();
  return <PublicBoard title={row.title} projection={projection} />;
}
