import Link from "next/link";

import { getLocations } from "@/lib/collection/queries";
import { AddCardForm } from "@/components/AddCardForm";

export const metadata = { title: "Add a card · MTGManager" };

export default async function AddCardPage() {
  const locations = await getLocations();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Add a card</h1>
          <p className="text-sm text-[--color-ink-muted]">
            Search your synced card database, pick the exact printing, then describe
            the copy you own.
          </p>
        </div>
        <Link href="/collection" className="text-sm text-[--color-accent] underline">
          Back to collection
        </Link>
      </div>

      <AddCardForm locations={locations} />
    </div>
  );
}
