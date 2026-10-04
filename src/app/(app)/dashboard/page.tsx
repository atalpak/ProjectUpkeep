import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata = { title: "Dashboard · Project Upkeep" };

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle="A home for your collection is on the way." />

      <section className="mx-auto max-w-2xl rounded-2xl border border-border bg-surface p-8 shadow-[var(--shadow-card)] sm:p-12">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent-text">Coming soon</p>
        <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Your collection at a glance.
        </h2>
        <p className="mt-4 max-w-prose text-sm leading-6 text-ink-muted">
          We’re working on a dashboard that brings your cards, decks, and activity together.
          In the meantime, you can keep using everything else in Project Upkeep.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/collection" className="retro-control rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90">
            View collection
          </Link>
          <Link href="/decks" className="retro-control rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted">
            View decks
          </Link>
        </div>
      </section>
    </div>
  );
}
