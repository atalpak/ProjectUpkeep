"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { createLocationInline } from "@/app/(app)/locations/actions";
import { Banner, Button, Field, Input, Select, cx } from "@/components/ui";
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  type Location,
  type LocationType,
} from "@/lib/types";

/**
 * The destination picker, used everywhere a card is filed.
 *
 * Two things a bare <select> of locations was missing:
 *
 *   - Order. A flat alphabetical list mixes decks, binders and boxes together,
 *     so finding "Box 3" means reading past four decks. Grouping by type with
 *     <optgroup> is the browser's own answer to that, and on a phone it is what
 *     turns the native picker into something scannable.
 *   - A way out. Realising you need a new binder while filing a card used to
 *     mean leaving the half-filled form to go and make one. "New location…"
 *     opens a small dialog and selects whatever it creates.
 *
 * Kept controlled internally so the newly created location can be selected
 * before the page has revalidated — the option is merged in locally, which
 * means the field never sits blank waiting for the server.
 */

/** Not a uuid, so it can never collide with a real location id. */
const NEW = "__new__";

/**
 * Locations arranged into type groups, in the canonical type order, sorted by
 * name within each.
 *
 * Exported so the collection filter — which needs the same grouping but has no
 * business creating containers — can use it without a second copy of the rule.
 * Numeric collation so "Box 10" sorts after "Box 9" rather than after "Box 1".
 */
export function groupLocationsByType(locations: Location[]) {
  return LOCATION_TYPES.map((type) => ({
    type,
    items: locations
      .filter((l) => l.type === type)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  })).filter((group) => group.items.length > 0);
}

export function LocationSelect({
  name,
  locations,
  defaultValue = "",
  /** What the empty choice is called. "Unsorted" when filing, "Everywhere" when filtering. */
  emptyLabel = "Unsorted",
  /** Filtering has no business creating containers. */
  allowCreate = true,
  className,
  ariaLabel,
  onValueChange,
}: {
  name?: string;
  locations: Location[];
  defaultValue?: string;
  emptyLabel?: string;
  allowCreate?: boolean;
  className?: string;
  ariaLabel?: string;
  onValueChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [created, setCreated] = useState<Location[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const select = useRef<HTMLSelectElement>(null);

  // Locally created rows are merged in so the new option exists the instant it
  // is selected. Once the page revalidates the same row arrives in `locations`;
  // the id keyed dedupe below stops it appearing twice in between.
  const seen = new Set(locations.map((l) => l.id));
  const all = [...locations, ...created.filter((l) => !seen.has(l.id))];

  const byType = groupLocationsByType(all);

  function change(next: string) {
    if (next === NEW) {
      // Leave the field on whatever it was; the dialog decides what it becomes.
      setDialogOpen(true);
      if (select.current) select.current.value = value;
      return;
    }
    setValue(next);
    onValueChange?.(next);
  }

  function applyCreated(location: Location) {
    setCreated((prev) => [...prev, location]);
    setValue(location.id);
    onValueChange?.(location.id);
    setDialogOpen(false);
  }

  return (
    <>
      {/* The real value travels in the form; the visible select is controlled. */}
      {name ? <input type="hidden" name={name} value={value} /> : null}

      <Select
        ref={select}
        value={value}
        onChange={(event) => change(event.currentTarget.value)}
        aria-label={ariaLabel}
        className={className}
      >
        <option value="">{emptyLabel}</option>

        {byType.map((group) => (
          <optgroup key={group.type} label={LOCATION_TYPE_LABELS[group.type]}>
            {group.items.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </optgroup>
        ))}

        {allowCreate ? <option value={NEW}>+ New location…</option> : null}
      </Select>

      {allowCreate && dialogOpen ? (
        <NewLocationDialog onCreated={applyCreated} onClose={() => setDialogOpen(false)} />
      ) : null}
    </>
  );
}

/**
 * Name and type, and nothing else.
 *
 * Nesting is deliberately absent: this is the two-second detour taken mid-form,
 * and a parent picker would turn it into the locations page. A container made
 * here can be moved inside another one later.
 *
 * Portalled to <body>, and that is load-bearing rather than tidiness. Every
 * destination picker sits inside a form — the add-card form, the importer, the
 * row editor, the bulk move — and a <form> inside a <form> is invalid HTML that
 * the parser silently drops, taking this dialog's submit handler with it. The
 * portal moves it out of that ancestor entirely.
 */
function NewLocationDialog({
  onCreated,
  onClose,
}: {
  onCreated: (location: Location) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  // Opening on mount rather than toggling: the dialog is only rendered while it
  // should be open, so there is no closed state to synchronise.
  const open = (el: HTMLDialogElement | null) => {
    if (el && !el.open) el.showModal();
    dialog.current = el;
  };

  // Awaited straight from the submit handler rather than through
  // useActionState: the result has to become selected state, and reading an
  // action result in an effect to call setState is the pattern React warns
  // about.
  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createLocationInline(formData);
      if (result.error || !result.location) {
        setError(result.error ?? "Could not create that location.");
        return;
      }
      onCreated(result.location);
    });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={open}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-label="New location"
      className={cx(
        "m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border",
        "bg-surface p-0 text-ink backdrop:bg-scrim",
      )}
    >
      <form action={submit} className="space-y-4 p-4">
        <h2 className="text-sm font-semibold">New location</h2>

        <Field label="Name">
          <Input
            name="name"
            placeholder="Commander Binder"
            maxLength={80}
            required
            autoFocus
          />
        </Field>

        <Field label="Type">
          <Select name="type" defaultValue="binder">
            {LOCATION_TYPES.map((type: LocationType) => (
              <option key={type} value={type}>
                {LOCATION_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        <Banner kind="error">{error}</Banner>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create and select"}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
