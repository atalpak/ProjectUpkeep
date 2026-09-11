import { FoilMark } from "@/components/FoilMark";
import { ManaCost } from "@/components/ManaCost";
import { Badge, Card as Panel } from "@/components/ui";
import { CONDITION_LABELS, cardDisplayName, type CardInstanceWithCard } from "@/lib/types";

/**
 * A read-only rendering of the cards someone has open for trade.
 *
 * The friend's-eye view of a trade binder without the way into a trade. The
 * profile page shows this to you for your own handle, where `ProfileTradables`
 * would offer to build an offer you cannot make with yourself. Purely
 * presentational, so it stays a server component — no search box, no gallery
 * toggle, no hover panel, just the list a friend would scan. The row shape is
 * deliberately the same as `ProfileTradables`' `TradableRow` so the preview and
 * the real thing read alike.
 */
export function TradableBinderPreview({ cards }: { cards: CardInstanceWithCard[] }) {
  // Sorted by card name: a friend's view is a flat list, and a stable order
  // makes "is this still what I want exposed?" a quick scan.
  const rows = [...cards].sort((a, b) =>
    (a.cards?.name ?? "").localeCompare(b.cards?.name ?? ""),
  );

  return (
    <Panel className="divide-y divide-border p-0">
      {rows.map((row) => {
        const card = row.cards;
        return (
          <div key={row.id} className="flex items-center gap-2 px-3 py-2">
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-muted">
              {row.quantity}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-sm font-medium">
                  {card ? cardDisplayName(card) : "Unknown printing"}
                </span>
                <FoilMark finish={row.finish} />
                <ManaCost cost={card?.mana_cost} size="xs" />
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                <span>{card?.set_name ?? card?.set_code?.toUpperCase()}</span>
                <Badge>{CONDITION_LABELS[row.condition] ?? row.condition}</Badge>
              </div>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}
