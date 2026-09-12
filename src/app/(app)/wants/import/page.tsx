import { WantImportPanel } from "@/components/social/WantImportPanel";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Import wish list · Project Upkeep" };

export default function WantImportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Import a wish list"
        subtitle="Paste a decklist, or drop in a CSV — the same formats the collection importer reads. Nothing is written until you have seen the preview."
        backHref="/wants"
        backLabel="Back to wish list"
      />

      <WantImportPanel />
    </div>
  );
}
