"use client";

import { useActionState, useState } from "react";

import {
  bulkDelete,
  bulkMerge,
  bulkMove,
  bulkSetField,
} from "@/app/(app)/collection/bulk-actions";
import { EMPTY_BULK_STATE, type BulkState } from "@/app/(app)/collection/bulk-state";
import { LocationSelect } from "@/components/LocationSelect";
import { Banner, Button, Select } from "@/components/ui";
import {
  CONDITIONS,
  CONDITION_LABELS,
  FINISHES,
  FINISH_LABELS,
  LANGUAGES,
  type Location,
} from "@/lib/types";

/**
 * Actions over the current selection.
 *
 * Appears only when something is selected, pinned to the bottom of the viewport
 * so it stays reachable however far down a long table the selection was made.
 *
 * Delete asks first. Everything else here is reversible by hand — a move can be
 * moved back, a condition re-set — but a deleted stack is gone, and the count is
 * the thing worth showing before it happens.
 */
export function BulkBar({
  ids,
  locations,
  onClear,
}: {
  ids: string[];
  locations: Location[];
  onClear: () => void;
}) {
  const [moveState, move, moving] = useActionState<BulkState, FormData>(
    bulkMove,
    EMPTY_BULK_STATE,
  );
  const [deleteState, remove, removing] = useActionState<BulkState, FormData>(
    bulkDelete,
    EMPTY_BULK_STATE,
  );
  const [fieldState, setField, settingField] = useActionState<BulkState, FormData>(
    bulkSetField,
    EMPTY_BULK_STATE,
  );
  const [mergeState, merge, merging] = useActionState<BulkState, FormData>(
    bulkMerge,
    EMPTY_BULK_STATE,
  );

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const busy = moving || removing || settingField || merging;

  // No effect resets the selection after a successful action, on purpose.
  //
  // Every action revalidates the page, so the table re-renders with fresh rows
  // and the parent narrows the selection to ids that still exist. A delete
  // therefore empties the selection by itself, this bar unmounts, and its
  // confirm state goes with it. A move or a condition change leaves the ids
  // valid and the selection standing, which is what you want when the next
  // thing you do is act on the same rows again.
  if (ids.length === 0) return null;

  const idList = ids.join(",");
  const error = moveState.error ?? deleteState.error ?? fieldState.error ?? mergeState.error;
  const notice = moveState.notice ?? deleteState.notice ?? fieldState.notice ?? mergeState.notice;

  return (
    <div className="sticky bottom-4 z-20 rounded-lg border border-border bg-surface-raised p-3 shadow-lg">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">
          {ids.length} selected
        </span>

        {/* Move. Each control group takes a full row on a phone — three of them
            side by side would each be too narrow to read a location name in. */}
        <form action={move} className="flex w-full items-center gap-1.5 sm:w-auto">
          <input type="hidden" name="ids" value={idList} />
          <LocationSelect
            name="location_id"
            locations={locations}
            ariaLabel="Move selection to"
            className="flex-1 text-xs sm:w-40 sm:flex-none"
          />
          <Button type="submit" variant="secondary" disabled={busy} className="text-xs">
            Move
          </Button>
        </form>

        {/* Set a field */}
        <FieldSetter idList={idList} action={setField} busy={busy} />

        {/* Merge */}
        <form action={merge}>
          <input type="hidden" name="ids" value={idList} />
          <Button type="submit" variant="secondary" disabled={busy} className="text-xs">
            {merging ? "Merging…" : "Merge duplicates"}
          </Button>
        </form>

        {/* Delete, behind a confirmation */}
        {confirmingDelete ? (
          <form action={remove} className="flex items-center gap-1.5">
            <input type="hidden" name="ids" value={idList} />
            <span className="text-xs text-ink-muted">
              Delete {ids.length} {ids.length === 1 ? "entry" : "entries"}?
            </span>
            <Button type="submit" variant="danger" disabled={busy} className="text-xs">
              {removing ? "Deleting…" : "Yes, delete"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmingDelete(false)}
              className="text-xs"
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            className="text-xs"
          >
            Delete
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          onClick={onClear}
          disabled={busy}
          className="ml-auto text-xs"
        >
          Clear selection
        </Button>
      </div>

      {error ? (
        <div className="mt-2">
          <Banner kind="error">{error}</Banner>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-2">
          <Banner kind="success">{notice}</Banner>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Set condition, finish or language across the selection.
 *
 * One control rather than three: which field is being set is itself a choice,
 * and three separate dropdown-plus-button pairs would crowd the bar for
 * something used occasionally.
 */
function FieldSetter({
  idList,
  action,
  busy,
}: {
  idList: string;
  action: (formData: FormData) => void;
  busy: boolean;
}) {
  const [field, setField] = useState<"condition" | "finish" | "language">("condition");

  const options =
    field === "condition"
      ? CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] }))
      : field === "finish"
        ? FINISHES.map((f) => ({ value: f, label: FINISH_LABELS[f] }))
        : LANGUAGES.map((l) => ({ value: l.code, label: l.label }));

  return (
    <form action={action} className="flex w-full items-center gap-1.5 sm:w-auto">
      <input type="hidden" name="ids" value={idList} />

      <Select
        name="field"
        value={field}
        onChange={(e) => setField(e.currentTarget.value as typeof field)}
        aria-label="Field to set"
        className="flex-1 text-xs sm:w-28 sm:flex-none"
      >
        <option value="condition">Condition</option>
        <option value="finish">Finish</option>
        <option value="language">Language</option>
      </Select>

      {/* Keyed so changing the field resets the value to that vocabulary's
          first option rather than keeping a stale one from the previous list. */}
      <Select
        key={field}
        name="value"
        aria-label="New value"
        className="flex-1 text-xs sm:w-36 sm:flex-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      <Button type="submit" variant="secondary" disabled={busy} className="text-xs">
        Set
      </Button>
    </form>
  );
}
