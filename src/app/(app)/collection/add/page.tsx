import { getLocations } from "@/lib/collection/queries";
import { AddCardForm } from "@/components/AddCardForm";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Add a card · MTGManager" };

export default async function AddCardPage() {
  const locations = await getLocations();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add a card"
        subtitle="Search your synced card database, pick the exact printing, then describe the copy you own."
        backHref="/collection"
        backLabel="Back to collection"
      />

      <AddCardForm locations={locations} />
    </div>
  );
}
