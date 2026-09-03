"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import {
  createLocation,
  deleteLocation,
  renameLocation,
} from "@/app/(app)/locations/actions";
import { EMPTY_LOCATION_STATE } from "@/app/(app)/locations/action-state";
import { Banner, Button, Card as Panel, Input, Select } from "@/components/ui";
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  type Location,
  type LocationNode,
} from "@/lib/types";

function LocationRow({
  location,
  count,
  nested,
}: {
  location: Location;
  count?: number;
  nested?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(renameLocation, EMPTY_LOCATION_STATE);

  return (
    <div className={nested ? "border-t border-border py-2 pl-6" : "py-2"}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/collection?location=${location.id}`}
            className="font-medium hover:underline"
          >
            {location.name}
          </Link>
          <span className="ml-2 text-xs text-ink-muted">
            {LOCATION_TYPE_LABELS[location.type]}
            {typeof count === "number"
              ? ` · ${count} card${count === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>

        <Button variant="ghost" className="text-xs" onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel" : "Rename"}
        </Button>

        <form action={deleteLocation}>
          <input type="hidden" name="location_id" value={location.id} />
          <Button variant="danger" type="submit" className="text-xs">
            Delete
          </Button>
        </form>
      </div>

      {editing ? (
        <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="location_id" value={location.id} />
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink-muted">Name</span>
            <Input name="name" defaultValue={location.name} maxLength={80} required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink-muted">Type</span>
            <Select name="type" defaultValue={location.type}>
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LOCATION_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <div className="w-full">
            <Banner kind="error">{state.error}</Banner>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function LocationManager({
  tree,
  topLevel,
}: {
  tree: LocationNode[];
  /** Valid parents. Only top-level locations qualify — nesting is one deep. */
  topLevel: Location[];
}) {
  const [state, action, pending] = useActionState(createLocation, EMPTY_LOCATION_STATE);

  return (
    <div className="space-y-6">
      <Panel>
        <h2 className="mb-3 text-sm font-medium">New location</h2>
        <form action={action} className="flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1 space-y-1">
            <span className="text-xs font-medium text-ink-muted">Name</span>
            <Input name="name" placeholder="Commander Binder" maxLength={80} required />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-ink-muted">Type</span>
            <Select name="type" defaultValue="binder">
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LOCATION_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-ink-muted">Inside</span>
            <Select name="parent_location_id" defaultValue="" className="w-52">
              <option value="">Nothing (top level)</option>
              {topLevel.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </label>

          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create"}
          </Button>

          <div className="w-full space-y-2">
            <Banner kind="error">{state.error}</Banner>
            <Banner kind="success">{state.notice}</Banner>
          </div>
        </form>
      </Panel>

      <div className="divide-y divide-border rounded-lg border border-border px-4">
        {tree.map((node) => (
          <div key={node.id} className="py-1">
            <LocationRow location={node} count={node.instance_count} />
            {node.children.map((child) => (
              <LocationRow key={child.id} location={child} nested />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
