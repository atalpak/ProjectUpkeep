import Link from "next/link";

import { getDecks } from "@/lib/collection/queries";
import { DeckManager } from "@/components/decks/DeckManager";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Decks · Project Upkeep" };

export default async function DecksPage() {
  const decks = await getDecks();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Decks"
        subtitle="A deck is a real place a card lives. Cards sleeved into one stop counting as available to build with."
        actions={
          <Link
            href="/decks/check"
            className="rounded-full border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted"
          >
            Check a list
          </Link>
        }
      />

      <DeckManager decks={decks} />
    </div>
  );
}
