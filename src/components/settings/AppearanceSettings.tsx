"use client";

import { setTheme, useTheme, type Theme } from "@/components/ThemeToggle";
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
  const theme = useTheme();

  return (
    <div className="divide-y divide-border">
      <Row
        label="Theme"
        description="Choose the look of this browser. Light and dark follow your system until you choose; Retro uses pale parchment, weathered stone, and brass accents."
        control={null}
      />

      <div className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-3" role="group" aria-label="Theme">
        {(["light", "dark", "retro"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTheme(option)}
            aria-pressed={theme === option}
            className={`theme-choice text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-offset-4 ${theme === option ? "theme-choice-selected" : ""}`}
          >
            <ThemePreview theme={option} />
            <span className="mt-2 flex items-center justify-between gap-2 text-sm font-semibold capitalize">
              {option}
              <span className="theme-choice-check" aria-hidden="true">{theme === option ? "✓" : ""}</span>
            </span>
          </button>
        ))}
      </div>

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
    </div>
  );
}

/** A small, self-contained mockup so each choice is visible before applying it. */
function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <span className={`theme-preview theme-preview-${theme}`} aria-hidden="true">
      <span className="theme-preview-bar"><i /><i /><i /><b>PROJECT UPKEEP</b></span>
      <span className="theme-preview-body">
        <span className="theme-preview-title">Collection <small>124 cards</small></span>
        <span className="theme-preview-rule" />
        <span className="theme-preview-actions"><em>All cards</em><em>Search cards</em></span>
        <span className="theme-preview-row"><span>Sol Ring</span><strong>× 2</strong></span>
        <span className="theme-preview-row"><span>Arcane Signet</span><strong>× 1</strong></span>
      </span>
    </span>
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
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        {note ? <p className="mt-0.5 text-xs text-ink-muted">{note}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
