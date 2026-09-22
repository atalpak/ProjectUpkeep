"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";

import { SetSymbol } from "@/components/SetSymbol";
import { cx } from "@/components/ui";
import { printingSummary, type PrintingFacts } from "@/lib/cards/printing-label";

/** What a picker needs of one printing; `/api/cards/printings` returns all of it. */
export type PrintingOption = PrintingFacts & {
  scryfall_id: string;
  image_uri_small?: string | null;
  image_uri?: string | null;
};

/**
 * One printing as a row: a small picture of that printing, the set, and the
 * number / year / rarity / finishes line. The same row is used by the picker
 * below and by the deck row menu, so a printing looks the same wherever it is
 * being chosen.
 *
 * The thumbnail is Scryfall's pre-sized `image_uri_small` (146x204) drawn at
 * about a quarter of that; `unoptimized` for the reason given in CardPanel.tsx
 * (their CDN already does the resizing). `next/image` lazy-loads by default,
 * so a card with 300 printings only fetches the pictures that scroll into
 * view. `content-visibility: auto` on the row means the offscreen ones are not
 * laid out or painted either, which is what keeps the long list cheap without
 * a virtualisation library.
 */
export function PrintingRow({ printing, current }: { printing: PrintingOption; current?: boolean }) {
  const { title, detail } = printingSummary(printing);
  const src = printing.image_uri_small ?? printing.image_uri;

  return (
    <span className="flex w-full items-center gap-2.5">
      <span className="relative block h-[50px] w-9 shrink-0 overflow-hidden rounded-[3px] bg-surface-muted">
        {src ? (
          <Image
            src={src}
            alt={`${title}${printing.collector_number ? ` #${printing.collector_number}` : ""} card image`}
            fill
            sizes="36px"
            className="object-cover"
            unoptimized
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <SetSymbol code={printing.set_code} size={12} />
          <span className="truncate">{title}</span>
          {current ? <span className="shrink-0 font-normal text-accent-text">(current)</span> : null}
        </span>
        {detail ? <span className="mt-0.5 block text-[11px] text-ink-muted">{detail}</span> : null}
      </span>
    </span>
  );
}

/** Keeps offscreen rows out of layout and paint; the height hint stops the scrollbar jumping. */
export const PRINTING_ROW_CLASS =
  "[content-visibility:auto] [contain-intrinsic-size:auto_66px]";

/**
 * The printing chooser: a button showing the current printing which opens an
 * in-flow list of every printing with its picture.
 *
 * A native <select> was used here until the pictures were asked for, and an
 * <option> cannot hold an image. The list opens in the page rather than as a
 * floating panel on purpose: the card popup is a modal <dialog>, whose top
 * layer hides anything portalled to <body>, and an absolute panel inside the
 * popup's scrolling body would be clipped by it. An in-flow list has neither
 * problem, and is capped and scrolls, so 300 printings do not push the form
 * down the page.
 */
export function PrintingPicker({
  printings,
  value,
  onChange,
  label,
  className,
}: {
  printings: PrintingOption[];
  value: string;
  onChange: (scryfallId: string) => void;
  /** Accessible name for the button, e.g. "Printing of Lightning Bolt". */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = printings.find((p) => p.scryfall_id === value) ?? printings[0];

  // Bring the current printing into view when the list opens, so a card with
  // a hundred printings does not open scrolled to the top of the wrong end.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // Escape closes the list and nothing else. Inside the card popup a bare
  // Escape would also fire the native <dialog>'s own cancel and close the whole
  // popup; that default is the keydown's, so it is prevented here, in the
  // capture phase so it happens whichever element has focus.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  if (!selected) return null;

  return (
    <div className={cx("space-y-1", className)}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${printingSummary(selected).title}`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-left transition-colors hover:bg-surface-muted coarse:min-h-11"
      >
        <PrintingRow printing={selected} />
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cx("size-3.5 shrink-0 text-ink-muted transition-transform", open && "rotate-180")}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          className="max-h-[min(20rem,50dvh)] overflow-y-auto rounded-md border border-border bg-surface-raised"
        >
          {printings.map((p) => {
            const isCurrent = p.scryfall_id === selected.scryfall_id;
            return (
              <button
                key={p.scryfall_id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                  if (!isCurrent) onChange(p.scryfall_id);
                }}
                className={cx(
                  PRINTING_ROW_CLASS,
                  "block w-full px-2 py-1.5 text-left transition-colors hover:bg-surface-muted coarse:min-h-11",
                  isCurrent && "bg-accent-soft",
                )}
              >
                <PrintingRow printing={p} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
