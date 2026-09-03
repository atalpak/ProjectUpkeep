"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  deleteCardInstance,
  updateCardInstance,
} from "@/app/(app)/collection/actions";
import { EMPTY_STATE } from "@/app/(app)/collection/action-state";
import { useActionState } from "react";
import { useCardPreview } from "@/components/CardPanel";
import { FoilMark } from "@/components/FoilMark";
import { SetSymbol } from "@/components/SetSymbol";
import { formatPrice, priceFor } from "@/lib/collection/pricing";
import { BulkBar } from "@/components/collection/BulkBar";
import { LocationSelect } from "@/components/LocationSelect";
import {
  COLUMNS,
  DEFAULT_COLUMNS,
  parseStoredColumns,
  readStoredColumns,
  readStoredColumnsOnServer,
  sortRows,
  subscribeToColumns,
  writeStoredColumns,
  type ColumnId,
  type SortState,
} from "@/components/collection/columns";
import {
  Badge,
  Banner,
  Button,
  Field,
  Input,
  Select,
  cx,
} from "@/components/ui";
import { availabilityFor, type Availability } from "@/lib/collection/availability";
import {
  CONDITIONS,
  CONDITION_LABELS,
  FINISH_LABELS,
  LANGUAGES,
  languageLabel,
  type CardInstanceWithCard,
  type Finish,
  type Location,
} from "@/lib/types";

/**
 * The collection as a table.
 *
 * Replaces the old card-per-row list. A collection is tabular data — the same
 * printing repeated with different conditions and locations — and a table is
 * what lets someone sort by set, scan for the foils, and select forty rows to
 * file at once.
 *
 * Hovering a card's name feeds the side panel, so the image and rules text are
 * available without giving every row a thumbnail.
 */

export function CollectionTable({
  rows,
  locations,
  availability,
}: {
  rows: CardInstanceWithCard[];
  locations: Location[];
  availability: Map<string, Availability>;
}) {
  // Subscribed rather than held in state: the choice lives in localStorage,
  // which the server cannot read. See the note in columns.ts.
  const storedColumns = useSyncExternalStore(
    subscribeToColumns,
    readStoredColumns,
    readStoredColumnsOnServer,
  );
  const visible = useMemo(() => parseStoredColumns(storedColumns), [storedColumns]);

  const [sort, setSort] = useState<SortState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  function toggleColumn(id: ColumnId) {
    const next = visible.includes(id) ? visible.filter((c) => c !== id) : [...visible, id];
    // Never let the table become columnless.
    writeStoredColumns(next.length === 0 ? DEFAULT_COLUMNS : next);
  }

  // Keep column order stable and canonical, whatever order they were toggled in.
  const columns = useMemo(
    () => COLUMNS.filter((c) => visible.includes(c.id)),
    [visible],
  );

  const sorted = useMemo(
    () => sortRows(rows, sort, { availability }),
    [rows, sort, availability],
  );

  // A filter change can remove rows that were selected; a selection must never
  // name a row the user can no longer see.
  const visibleIds = useMemo(() => new Set(sorted.map((r) => r.id)), [sorted]);
  const liveSelection = useMemo(
    () => [...selected].filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  );

  const allSelected = sorted.length > 0 && liveSelection.length === sorted.length;
  const someSelected = liveSelection.length > 0 && !allSelected;

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(sorted.map((r) => r.id)));
  }

  function headerClick(id: ColumnId) {
    setSort((prev) =>
      prev?.column === id
        ? { column: id, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column: id, direction: "asc" },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {liveSelection.length > 0
            ? `${liveSelection.length} selected`
            : `${sorted.length} ${sorted.length === 1 ? "entry" : "entries"}`}
        </p>

        <div className="flex flex-1 items-center justify-end gap-2">
          {/* Sorting lives in the column headers, which the stacked mobile list
              does not have — so below sm it gets a control of its own rather
              than losing the ability entirely. */}
          <div className="min-w-0 max-w-44 flex-1 sm:hidden">
            <Select
              aria-label="Sort by"
              className="text-xs"
              value={sort ? `${sort.column}:${sort.direction}` : ""}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (!value) return setSort(null);
                const [column, direction] = value.split(":");
                setSort({
                  column: column as ColumnId,
                  direction: direction as "asc" | "desc",
                });
              }}
            >
              <option value="">Unsorted</option>
              {COLUMNS.flatMap((column) => [
                <option key={`${column.id}:asc`} value={`${column.id}:asc`}>
                  {column.label} ↑
                </option>,
                <option key={`${column.id}:desc`} value={`${column.id}:desc`}>
                  {column.label} ↓
                </option>,
              ])}
            </Select>
          </div>

          {/* Which columns show is a table question; the stacked list has a
              fixed shape, so the picker would be a control over nothing. */}
          <div className="hidden sm:block">
            <ColumnPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              visible={visible}
              onToggle={toggleColumn}
            />
          </div>
        </div>
      </div>

      {/* Below sm, one card per entry. A six-column table is 40rem wide at its
          narrowest, which on a phone is a page you read by dragging sideways —
          so that width is spent going down the screen instead. */}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border sm:hidden">
        {sorted.map((row) => (
          <MobileRow
            key={row.id}
            row={row}
            locations={locations}
            availability={availabilityFor(availability, row.cards)}
            selected={selected.has(row.id)}
            onToggle={() => toggleRow(row.id)}
            editing={editing === row.id}
            onEditToggle={() => setEditing((cur) => (cur === row.id ? null : row.id))}
          />
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-border bg-surface-muted text-left">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    // Indeterminate is not an attribute, only a property.
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label={allSelected ? "Clear selection" : "Select all rows"}
                />
              </th>

              {columns.map((column) => {
                const active = sort?.column === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                    className={cx("px-3 py-2 font-medium", column.numeric && "text-right")}
                  >
                    <button
                      type="button"
                      onClick={() => headerClick(column.id)}
                      className="inline-flex items-center gap-1 hover:text-ink"
                    >
                      {column.label}
                      <span aria-hidden="true" className="text-ink-muted">
                        {active ? (sort.direction === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}

              <th scope="col" className="w-12 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {sorted.map((row) => (
              <Row
                key={row.id}
                row={row}
                columns={columns}
                locations={locations}
                availability={availabilityFor(availability, row.cards)}
                selected={selected.has(row.id)}
                onToggle={() => toggleRow(row.id)}
                editing={editing === row.id}
                onEditToggle={() => setEditing((cur) => (cur === row.id ? null : row.id))}
              />
            ))}
          </tbody>
        </table>
      </div>

      <BulkBar
        ids={liveSelection}
        locations={locations}
        onClear={() => setSelected(new Set())}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row, stacked (mobile)
// ---------------------------------------------------------------------------

/**
 * An entry as a card rather than a table row.
 *
 * Shows the fixed set of facts worth having on a phone — what it is, how many,
 * what condition, where it lives, how many are free — instead of whichever
 * columns are switched on. Tapping the name opens the card sheet, which is the
 * only way to see the art and rules text on a touch device.
 */
function MobileRow({
  row,
  locations,
  availability,
  selected,
  onToggle,
  editing,
  onEditToggle,
}: {
  row: CardInstanceWithCard;
  locations: Location[];
  availability: Availability;
  selected: boolean;
  onToggle: () => void;
  editing: boolean;
  onEditToggle: () => void;
}) {
  const card = row.cards;
  const preview = useCardPreview(card);

  return (
    <li className={cx("p-3", selected && "bg-accent-soft")}>
      <div className="flex gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${card?.name ?? "row"}`}
          className="mt-1 size-4 shrink-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span {...preview} tabIndex={0} className="font-medium">
                {card?.name ?? "Unknown printing"}
              </span>
              <FoilMark finish={row.finish} />
              <p className="flex items-center gap-1.5 truncate text-xs text-ink-muted">
                <SetSymbol code={card?.set_code} size={12} />
                {card?.set_name ?? card?.set_code?.toUpperCase() ?? "—"}
              </p>
            </div>

            <RowMenu row={row} onEdit={onEditToggle} editing={editing} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-medium tabular-nums">×{row.quantity}</span>
            <Badge>{CONDITION_LABELS[row.condition] ?? row.condition}</Badge>
            <span className={row.locations ? "" : "text-ink-muted"}>
              {row.locations?.name ?? "Unsorted"}
            </span>
            <span
              className="tabular-nums text-ink-muted"
              title={`${availability.total} owned · ${availability.inDecks} in decks · ${availability.available} free`}
            >
              {availability.available}/{availability.total} free
            </span>
            <PriceCell row={row} />
          </div>

          {editing ? (
            <div className="mt-3 border-t border-border pt-3">
              <RowEditor row={row} locations={locations} onDone={onEditToggle} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

function Row({
  row,
  columns,
  locations,
  availability,
  selected,
  onToggle,
  editing,
  onEditToggle,
}: {
  row: CardInstanceWithCard;
  columns: typeof COLUMNS;
  locations: Location[];
  availability: Availability;
  selected: boolean;
  onToggle: () => void;
  editing: boolean;
  onEditToggle: () => void;
}) {
  const card = row.cards;
  const preview = useCardPreview(card);

  return (
    <>
      <tr className={cx("hover:bg-surface-muted", selected && "bg-accent-soft")}>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${card?.name ?? "row"}`}
          />
        </td>

        {columns.map((column) => (
          <td
            key={column.id}
            className={cx("px-3 py-2", column.numeric && "text-right tabular-nums")}
          >
            <Cell row={row} column={column.id} preview={preview} availability={availability} />
          </td>
        ))}

        <td className="px-3 py-2 text-right">
          <RowMenu row={row} onEdit={onEditToggle} editing={editing} />
        </td>
      </tr>

      {editing ? (
        <tr>
          <td colSpan={columns.length + 2} className="bg-surface-muted px-3 py-3">
            <RowEditor row={row} locations={locations} onDone={onEditToggle} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Cell({
  row,
  column,
  preview,
  availability,
}: {
  row: CardInstanceWithCard;
  column: ColumnId;
  preview: Record<string, unknown>;
  availability: Availability;
}) {
  const card = row.cards;

  switch (column) {
    case "quantity":
      return <span className="font-medium">{row.quantity}</span>;

    case "name":
      // The hover target for the side panel. A span rather than a link: the row
      // has its own actions, and navigating away on a click would fight them.
      return (
        <>
          <span
            {...preview}
            tabIndex={0}
            className="cursor-default font-medium hover:underline"
          >
            {card?.name ?? "Unknown printing"}
          </span>
          <FoilMark finish={row.finish} />
        </>
      );

    case "set":
      return (
        <span className="inline-flex items-center gap-1.5 text-ink-muted">
          <SetSymbol code={card?.set_code} />
          {card?.set_name ?? card?.set_code?.toUpperCase() ?? "—"}
        </span>
      );

    case "collector":
      return <span className="text-ink-muted">{card?.collector_number ?? "—"}</span>;

    case "rarity":
      return <span className="capitalize text-ink-muted">{card?.rarity ?? "—"}</span>;

    case "manaCost":
      return <span className="text-ink-muted">{card?.mana_cost || "—"}</span>;

    case "manaValue":
      return <span>{card?.cmc ?? "—"}</span>;

    case "type":
      return <span className="text-ink-muted">{card?.type_line ?? "—"}</span>;

    case "colors": {
      const colors = card?.colors ?? [];
      return <span className="text-ink-muted">{colors.length > 0 ? colors.join("") : "C"}</span>;
    }

    case "power":
      return (
        <span>
          {card?.loyalty
            ? card.loyalty
            : card?.power
              ? `${card.power}/${card.toughness ?? "—"}`
              : "—"}
        </span>
      );

    case "condition":
      return <Badge>{CONDITION_LABELS[row.condition] ?? row.condition}</Badge>;

    case "language":
      return <span className="text-ink-muted">{languageLabel(row.language)}</span>;

    case "location":
      return (
        <span className={row.locations ? "" : "text-ink-muted"}>
          {row.locations?.name ?? "Unsorted"}
        </span>
      );

    case "artist":
      return <span className="text-ink-muted">{card?.artist ?? "—"}</span>;

    case "notes":
      return <span className="text-ink-muted">{row.notes ?? "—"}</span>;

    case "price":
      // Per copy, for this row's finish — a foil is not worth its non-foil
      // price. Multiplied by quantity in the title, which is the number that
      // matters for a stack.
      return (
        <PriceCell row={row} />
      );

    case "available":
      // Counted across every printing of this card rather than just this row,
      // because that is the question actually being asked: have I got one free
      // to put in a deck?
      return (
        <span
          title={`${availability.total} owned · ${availability.inDecks} in decks · ${availability.available} free`}
          className={availability.available === 0 ? "text-ink-muted" : "font-medium"}
        >
          {availability.available}
          <span className="font-normal text-ink-muted"> / {availability.total}</span>
        </span>
      );
  }
}

/**
 * The price of one row.
 *
 * Shows the unit price for this copy's finish, with the stack total in the
 * tooltip — a shelf of four is worth four times one, and both numbers are worth
 * having without spending two columns on them.
 *
 * Renders unconditionally: the column's own visibility is the switch now, so
 * consulting a second preference would mean a "Price" column that shows dashes.
 */
function PriceCell({ row }: { row: CardInstanceWithCard }) {
  const unit = priceFor(row.cards, row.finish);
  const stack = unit === null ? null : unit * row.quantity;

  return (
    <span
      className={cx("tabular-nums", unit === null && "text-ink-muted")}
      title={
        unit === null
          ? "No recent sale for this finish"
          : `${row.quantity} × ${formatPrice(unit)} = ${formatPrice(stack)}`
      }
    >
      {formatPrice(unit)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The three-dot menu
// ---------------------------------------------------------------------------

function RowMenu({
  row,
  onEdit,
  editing,
}: {
  row: CardInstanceWithCard;
  onEdit: () => void;
  editing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, the two things every menu owes you.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${row.cards?.name ?? "this entry"}`}
        className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink coarse:size-9"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onEdit();
              setOpen(false);
            }}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
          >
            {editing ? "Close editor" : "Edit"}
          </button>

          {row.cards?.purchase_uri ? (
            <a
              role="menuitem"
              href={row.cards.purchase_uri}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => setOpen(false)}
              className="block w-full border-t border-border px-3 py-2 text-left text-sm hover:bg-surface-muted"
            >
              Buy on TCGplayer
            </a>
          ) : null}
          {row.cards?.name ? (
            <a
              role="menuitem"
              href={`https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(
                row.cards.name,
              )}`}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => setOpen(false)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
            >
              Buy on Card Kingdom
            </a>
          ) : null}

          <form action={deleteCardInstance} className="border-t border-border">
            <input type="hidden" name="instance_id" value={row.id} />
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-surface-muted"
            >
              Delete
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline editor
// ---------------------------------------------------------------------------

function RowEditor({
  row,
  locations,
  onDone,
}: {
  row: CardInstanceWithCard;
  locations: Location[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(updateCardInstance, EMPTY_STATE);
  const card = row.cards;

  const finishes = (card?.available_finishes?.length
    ? card.available_finishes
    : ["nonfoil"]) as Finish[];
  // A previously recorded finish this printing no longer lists must stay
  // selectable, or saving an unrelated edit would silently change it.
  const finishOptions = Array.from(new Set([...finishes, row.finish])) as Finish[];

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="instance_id" value={row.id} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Condition">
          <Select name="condition" defaultValue={row.condition}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Finish">
          <Select name="finish" defaultValue={row.finish}>
            {finishOptions.map((f) => (
              <option key={f} value={f}>
                {FINISH_LABELS[f] ?? f}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Language">
          <Select name="language" defaultValue={row.language}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Location">
          <LocationSelect
            name="location_id"
            locations={locations}
            defaultValue={row.location_id ?? ""}
          />
        </Field>

        <Field label="Quantity">
          <Input name="quantity" type="number" min={1} max={10000} defaultValue={row.quantity} />
        </Field>

        <Field label="Notes" hint="A card with a note is never merged into a stack.">
          <Input name="notes" maxLength={500} defaultValue={row.notes ?? ""} />
        </Field>
      </div>

      <Banner kind="error">{state.error}</Banner>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Close
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Column picker
// ---------------------------------------------------------------------------

function ColumnPicker({
  open,
  onOpenChange,
  visible,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visible: ColumnId[];
  onToggle: (id: ColumnId) => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) onOpenChange(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={container} className="relative">
      <Button variant="secondary" type="button" onClick={() => onOpenChange(!open)}>
        Columns ({visible.length})
      </Button>

      {open ? (
        <div className="absolute right-0 z-20 mt-1 max-h-80 w-56 overflow-y-auto rounded-md border border-border bg-surface-raised p-2 shadow-lg">
          {COLUMNS.map((column) => (
            <label
              key={column.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                checked={visible.includes(column.id)}
                onChange={() => onToggle(column.id)}
              />
              {column.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
