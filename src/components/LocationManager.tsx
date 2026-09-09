"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";

import {
  createLocation,
  deleteLocation,
  renameLocation,
} from "@/app/(app)/locations/actions";
import { EMPTY_LOCATION_STATE } from "@/app/(app)/locations/action-state";
import { setLocationTradable } from "@/app/(app)/friends/actions";
import { Badge, Banner, Button, Card as Panel, Input, Select, cx } from "@/components/ui";
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  type Location,
  type LocationNode,
  type LocationType,
} from "@/lib/types";

/**
 * Where cards physically live.
 *
 * This page used to be a form over a list of text rows, which is a strange way
 * to render the idea the whole product rests on: that a card is somewhere real.
 * A container now shows what is in it — five of its cards, how full it is
 * relative to the others — and carries the one switch that makes any of it
 * visible to a friend.
 */

/**
 * A glyph per container type.
 *
 * Deliberately shapes rather than colours: a binder, a box and a deck are
 * different objects on a shelf, and the difference should survive being read
 * quickly, in either theme, by someone who does not distinguish hues.
 */
const TYPE_GLYPHS: Record<LocationType, string> = {
  binder: "▤",
  box: "▥",
  deck: "◈",
  other: "▪",
};

function TypeMark({ type }: { type: LocationType }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-base text-ink-muted"
    >
      {TYPE_GLYPHS[type]}
    </span>
  );
}

/** Up to five cards from the container, overlapped like a fanned stack. */
function Peek({ images, name }: { images: string[]; name: string }) {
  if (images.length === 0) return null;

  return (
    <div className="hidden shrink-0 items-center sm:flex" aria-hidden="true" title={`Cards in ${name}`}>
      {images.map((src, i) => (
        <Image
          key={`${src}-${i}`}
          src={src}
          alt=""
          width={146}
          height={204}
          unoptimized
          // Overlapped rather than spaced: five cards in a row would be wider
          // than the name beside them, and a fan reads as "a stack of cards"
          // at a glance where a grid reads as "five things".
          className={cx(
            "h-11 w-8 rounded-[3px] border border-border object-cover object-top",
            i > 0 && "-ml-5",
          )}
        />
      ))}
    </div>
  );
}

/**
 * The switch that makes a container's cards visible to friends.
 *
 * It lived only on the Friends page, five sections down, which is a strange
 * home for a property of a container — and it is the thing every new person has
 * to find before any of the social half works. It is still on Friends; this is
 * the copy that sits where containers are managed.
 */
function TradableToggle({ location }: { location: Location }) {
  const on = location.is_tradable;

  return (
    <form action={setLocationTradable} className="shrink-0">
      <input type="hidden" name="location_id" value={location.id} />
      <input type="hidden" name="is_tradable" value={on ? "false" : "true"} />
      <button
        type="submit"
        role="switch"
        aria-checked={on}
        aria-label={on ? `Close ${location.name} to trade` : `Open ${location.name} for trade`}
        title={
          on
            ? "Friends can see the cards in here. Click to make it private."
            : "Private. Click to let friends see these cards for trade."
        }
        className={cx(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors coarse:min-h-11",
          on
            ? "border-accent bg-accent-soft text-ink"
            : "border-border text-ink-muted hover:bg-surface-muted",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "flex h-3.5 w-6 shrink-0 items-center rounded-full px-0.5 transition-colors",
            on ? "bg-accent" : "bg-surface-muted",
          )}
        >
          <span
            className={cx(
              "size-2.5 rounded-full bg-surface transition-transform",
              on && "translate-x-2.5",
            )}
          />
        </span>
        {on ? "Open for trade" : "Private"}
      </button>
    </form>
  );
}

function LocationRow({
  location,
  count,
  images,
  largest,
  nested,
}: {
  location: Location;
  count: number;
  images: string[];
  largest: number;
  nested?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, action, pending] = useActionState(renameLocation, EMPTY_LOCATION_STATE);

  const fill = largest > 0 ? Math.max(2, (count / largest) * 100) : 0;

  return (
    <div className={cx("py-3", nested && "border-t border-border pl-6")}>
      <div className="flex items-start gap-3">
        <TypeMark type={location.type} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={`/collection?location=${location.id}`}
                className="truncate font-medium hover:underline"
              >
                {location.name}
              </Link>
              <Badge>{LOCATION_TYPE_LABELS[location.type]}</Badge>
            </div>

            <LocationMenu
              location={location}
              open={menuOpen}
              setOpen={setMenuOpen}
              onRename={() => {
                setEditing((v) => !v);
                setMenuOpen(false);
              }}
            />
          </div>

          {/* Wraps rather than squeezing: on a phone the bar takes its own
              line and the switch drops below it, instead of six things
              fighting over 375px and the peek sliding over the name. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex min-w-40 flex-1 items-center gap-2">
              <div className="h-1.5 min-w-16 max-w-48 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <span
                  className="block h-full rounded-full bg-accent/70"
                  style={{ width: `${Math.min(100, fill)}%` }}
                />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                {count} card{count === 1 ? "" : "s"}
              </span>
            </div>

            {/* Decorative, and the first thing to go when space is tight. */}
            <Peek images={images} name={location.name} />

            {/* A deck's contents are visible to friends through the trade
                binder switch too, but opening a built deck for trade is almost
                never what someone means, so it is not offered here.

                The slot keeps its width when empty, from `sm` up: without it a
                deck row's card peek slides into the space a box row spends on
                its switch, and the list stops reading as columns. On a phone
                the row wraps anyway, so the reservation would just be a hole. */}
            <div className="sm:w-[8.5rem] sm:shrink-0">
              {location.type !== "deck" ? <TradableToggle location={location} /> : null}
            </div>
          </div>
        </div>
      </div>

      {editing ? (
        <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
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
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <div className="w-full">
            <Banner kind="error">{state.error}</Banner>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function LocationMenu({
  location,
  open,
  setOpen,
  onRename,
}: {
  location: Location;
  open: boolean;
  setOpen: (open: boolean) => void;
  onRename: () => void;
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={`Options for ${location.name}`}
        aria-expanded={open}
        className="inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink coarse:size-11"
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="16" cy="10" r="1.5" />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl">
          <button
            type="button"
            onClick={onRename}
            className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted"
          >
            Rename
          </button>
          <form action={deleteLocation}>
            <input type="hidden" name="location_id" value={location.id} />
            <button
              type="submit"
              className="block w-full px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-surface-muted"
            >
              Delete
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function LocationManager({
  tree,
  topLevel,
  peek,
  counts,
  largest,
}: {
  tree: LocationNode[];
  /** Valid parents. Only top-level locations qualify — nesting is one deep. */
  topLevel: Location[];
  peek: Map<string, string[]>;
  counts: Map<string, number>;
  largest: number;
}) {
  const [state, action, pending] = useActionState(createLocation, EMPTY_LOCATION_STATE);
  const [adding, setAdding] = useState(tree.length === 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold tracking-tight">
          Your containers{tree.length > 0 ? ` (${tree.length})` : ""}
        </h2>
        {/* The form used to sit open above the list, so the first thing this
            page showed was data entry rather than the shelf it describes. */}
        <Button type="button" variant="secondary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "New container"}
        </Button>
      </div>

      {adding ? (
        <Panel>
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
      ) : null}

      {tree.length > 0 ? (
        <Panel className="divide-y divide-border p-0 px-4">
          {tree.map((node) => (
            <div key={node.id}>
              <LocationRow
                location={node}
                count={node.instance_count}
                images={peek.get(node.id) ?? []}
                largest={largest}
              />
              {node.children.map((child) => (
                <LocationRow
                  key={child.id}
                  location={child}
                  count={counts.get(child.id) ?? 0}
                  images={peek.get(child.id) ?? []}
                  largest={largest}
                  nested
                />
              ))}
            </div>
          ))}
        </Panel>
      ) : null}
    </div>
  );
}
