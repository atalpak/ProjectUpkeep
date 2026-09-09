import { ListCheck } from "@/components/decks/ListCheck";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Check a list · Project Upkeep" };

/**
 * The front door.
 *
 * Someone sends you a decklist, or you find one on YouTube. Before deciding
 * anything, the question is "how much of this do I already have?" — and until
 * now the only way to ask it was to create a deck, import the list, look, and
 * then delete the deck. Five decks browsed on a Sunday left five decks behind.
 */
export default function CheckListPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Check a list"
        subtitle="Paste a decklist and see what you already own, what is sleeved into other decks, and what you would still have to find. Nothing is saved unless you ask."
        backHref="/decks"
        backLabel="Back to decks"
      />

      <ListCheck />
    </div>
  );
}
