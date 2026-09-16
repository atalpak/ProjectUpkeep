import Image from "next/image";
import Link from "next/link";

import { artCropUrl } from "@/lib/collection/art";
import { ManaSymbol } from "@/components/ManaCost";
import { cx } from "@/components/ui";
import type { PublicDeckSummary } from "@/lib/social/queries";

/**
 * A friend's decks they have chosen to share (migration 35) — commander art,
 * name, format, card count. No sleeved/build-progress number here: that
 * belongs to `card_instances`, which this section never touches, the same
 * boundary `getPublicDecks` keeps in the query itself.
 *
 * Purely presentational, like `TradableBinderPreview` beside it — the profile
 * page has already decided who is allowed to see this before rendering it.
 */
export function ProfilePublicDecks({
  username,
  decks,
}: {
  username: string;
  decks: PublicDeckSummary[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {decks.map((deck) => {
        const art = artCropUrl(deck.commanderImage);
        return (
          <Link
            key={deck.id}
            href={`/u/${encodeURIComponent(username)}/decks/${deck.id}`}
            className="relative block aspect-[9/8] overflow-hidden rounded-2xl border border-border transition-colors hover:border-accent/50"
          >
            {art ? (
              <>
                <Image
                  src={art}
                  alt=""
                  fill
                  unoptimized
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="absolute inset-0 object-cover object-top"
                />
                <div className="absolute inset-0 bg-black/55" />
              </>
            ) : (
              <div className="absolute inset-0 bg-surface-muted" />
            )}

            <div
              className={cx(
                "relative z-10 flex h-full flex-col justify-between gap-2 p-3",
                art ? "text-white" : "text-ink",
              )}
            >
              {deck.commanderColors.length > 0 ? (
                <div className="flex gap-0.5">
                  {deck.commanderColors.map((code) => (
                    <ManaSymbol key={code} code={code} size="xs" />
                  ))}
                </div>
              ) : (
                <span />
              )}

              <div className="space-y-0.5">
                <p className="truncate font-display text-lg font-bold leading-tight tracking-tight">
                  {deck.name}
                </p>
                <p className={cx("truncate text-xs", art ? "text-white/80" : "text-ink-muted")}>
                  {deck.format ? `${deck.format} · ` : ""}
                  {deck.commanderName ?? `${deck.cardCount} card${deck.cardCount === 1 ? "" : "s"}`}
                </p>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
