"use client";

import Image from "next/image";
import { useState } from "react";

import { CardPreviewTarget } from "@/components/CardPanel";
import { FlipButton, useCardFace } from "@/components/cards/FlipCard";
import { cx } from "@/components/ui";
import { describeSupplier, type WantRow } from "@/lib/social/wants";

export type ProfileWantMatch = { available: number; locations: string[] };
export type ProfileWantCard = Pick<WantRow, "id" | "displayName" | "cardId" | "image" | "imageLarge" | "flip" | "quantity">;

/** Read-only wish list for the owner and accepted friends. Notes and deck tags stay private. */
export function ProfileWants({
  wants,
  matches = {},
}: {
  wants: ProfileWantCard[];
  matches?: Record<string, ProfileWantMatch>;
}) {
  const [view, setView] = useState<"list" | "images">("list");

  if (wants.length === 0) {
    return <p className="text-sm text-ink-muted">No cards on this wish list yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Wish list view">
          {(["list", "images"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cx(
                "px-2.5 py-1.5 text-xs font-medium transition-colors",
                view === option ? "bg-accent text-accent-ink" : "hover:bg-surface-muted",
              )}
            >
              {option === "list" ? "List" : "Images"}
            </button>
          ))}
        </div>
      </div>

      {view === "images" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {wants.map((want) => (
            <WantImage key={want.id} want={want} match={matches[want.id]} />
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {wants.map((want) => (
            <li key={want.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-muted">{want.quantity}</span>
              <div className="min-w-0 flex-1">
                <CardPreviewTarget card={want.cardId} className="block w-fit max-w-full cursor-pointer truncate font-medium hover:underline">
                  {want.displayName}
                </CardPreviewTarget>
                {matches[want.id] ? (
                  <p className="text-xs text-accent-text">You have {describeSupplier(matches[want.id].available, matches[want.id].locations)}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WantImage({ want, match }: { want: ProfileWantCard; match?: ProfileWantMatch }) {
  const face = useCardFace(want.flip, "normal");
  const image = face.image ?? want.imageLarge ?? want.image;
  const name = face.name ?? want.displayName;

  return (
    <li className="min-w-0 space-y-1.5">
      <div className="relative">
        <div
          className={cx(
            "relative block aspect-[488/680] overflow-hidden rounded-lg border bg-surface-muted",
            match ? "border-accent" : "border-border",
          )}
        >
          {image ? (
            <Image
              src={image}
              alt={name}
              fill
              sizes="(min-width: 1280px) 12rem, (min-width: 640px) 25vw, 45vw"
              className="object-cover"
              onError={face.onImageError}
              unoptimized
            />
          ) : (
            <span className="flex h-full items-center justify-center p-2 text-center text-xs text-ink-muted">{name}</span>
          )}
        </div>
        {face.canFlip ? <FlipButton onFlip={face.flip} otherName={face.otherName} /> : null}
        {want.quantity > 1 ? (
          <span className="absolute bottom-1 right-1 rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">{want.quantity}×</span>
        ) : null}
      </div>
      <p className="truncate text-xs font-medium" title={name}>{name}</p>
      {match ? <p className="truncate text-xs text-accent-text">You have {describeSupplier(match.available, match.locations)}</p> : null}
    </li>
  );
}
