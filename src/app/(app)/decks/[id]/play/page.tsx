import { createHash } from "node:crypto";
import { notFound } from "next/navigation";

import { PlayBoard } from "@/components/playtester/PlayBoard";
import { getDeck, getDeckList } from "@/lib/collection/queries";
import { fingerprintText } from "@/lib/playtest/board/fingerprint";
import { slimEntry } from "@/lib/playtest/slim";
import { getCurrentUser } from "@/lib/supabase/server";
import { createShare, deleteSession, deleteShare, duplicateSession, overwriteSession, refreshShare, renameSession, saveSession } from "./actions";
import { loadSaves, loadSession } from "./sessions";

export const metadata = { title: "Play · Project Upkeep" };
/** Signed-in deck data: never prerender. */
export const dynamic = "force-dynamic";

export default async function PlayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ session?: string }> }) {
  const { id } = await params;
  const { session } = await searchParams;
  const user = await getCurrentUser();
  if (!user) notFound();
  const deck = await getDeck(id);
  if (!deck || deck.user_id !== user.id) notFound();
  const fullEntries = await getDeckList(id);
  const entries = fullEntries.map(slimEntry);
  const fingerprint = createHash("sha256").update(fingerprintText(entries.map((e) => ({ cardId: e.card_id, quantity: e.quantity })), deck.commander_card_id ? [deck.commander_card_id] : [])).digest("hex");
  const [saves, initialSession] = await Promise.all([loadSaves(id, user.id), session ? loadSession(id, user.id, session) : Promise.resolve(null)]);
  const actions = {
    saveSession: saveSession.bind(null, id), overwriteSession: overwriteSession.bind(null, id), renameSession: renameSession.bind(null, id), duplicateSession: duplicateSession.bind(null, id), deleteSession: deleteSession.bind(null, id), createShare: createShare.bind(null, id), refreshShare: refreshShare.bind(null, id), deleteShare: deleteShare.bind(null, id),
  };
  return <PlayBoard deckId={id} deckName={deck.name} userId={user.id} fingerprint={fingerprint} entries={entries} commanderCardId={deck.commander_card_id} saves={saves} initialSession={initialSession} actions={actions} />;
}
