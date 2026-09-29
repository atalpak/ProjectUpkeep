"use client";

import { ThemeToggle } from "@/components/ThemeToggle";
import { CardPreviewToggle, useCardPreviewMode } from "@/components/CardPreviewMode";

/**
 * The per-browser preferences, gathered where someone would go looking for them.
 *
 * These live in localStorage rather than on the account, so they are set per
 * device — a phone and a desktop can reasonably disagree about whether a card
 * sidebar is wanted. The page says so rather than letting it be a surprise.
 *
 * The controls are the same components as in the header; this is a second place
 * to reach them, not a second implementation.
 */
export function AppearanceSettings() {
  const mode = useCardPreviewMode();

  return (
    <dl className="divide-y divide-border">
      <Row
        label="Theme"
        description="Light or dark. Follows your system until you choose."
        control={<ThemeToggle />}
      />

      <Row
        label="Explorer"
        description={
          mode === "sidebar"
            ? "Open beside the page for cards, decks, locations and your wish list."
            : "Closed; card previews appear on hover and the page uses the full width."
        }
        control={<CardPreviewToggle className="lg:inline-flex" />}
        // The toggle hides itself below lg, where neither mode applies.
        note="Desktop only — on a touch screen, tapping a card opens its details."
      />
    </dl>
  );
}

function Row({
  label,
  description,
  control,
  note,
}: {
  label: string;
  description: string;
  control: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-sm font-medium">{label}</dt>
        <dd className="mt-0.5 text-sm text-ink-muted">{description}</dd>
        {note ? <dd className="mt-0.5 text-xs text-ink-muted">{note}</dd> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
