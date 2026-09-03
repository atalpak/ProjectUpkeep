import { getLocations } from "@/lib/collection/queries";
import { ImportForm } from "@/components/ImportForm";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Import · Project Upkeep" };

export default async function ImportPage() {
  const locations = await getLocations();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import cards"
        subtitle="Paste a decklist, or drop in a CSV export from Moxfield, ManaBox, Archidekt or Deckbox. Nothing is written until you have seen the preview."
        backHref="/collection"
        backLabel="Back to collection"
      />

      <ImportForm locations={locations} />
    </div>
  );
}
