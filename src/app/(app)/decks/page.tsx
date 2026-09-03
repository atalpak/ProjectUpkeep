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
      />

      <DeckManager decks={decks} />
    </div>
  );
}
