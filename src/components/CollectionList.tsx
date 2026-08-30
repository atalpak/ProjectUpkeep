"use client";

import { useState } from "react";
import Image from "next/image";

import {
  deleteCardInstance,
  moveCardInstance,
  updateCardInstance,
  EMPTY_STATE,
} from "@/app/(app)/collection/actions";
import { useActionState } from "react";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
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
 * One row of the collection, with inline move, edit and delete.
 *
 * Move gets its own always-visible control rather than living behind "edit":
 * reassigning where a card lives is the thing this product is for, and burying
 * it two clicks deep would be backwards.
 */
function InstanceRow({
  instance,
  locations,
}: {
  instance: CardInstanceWithCard;
  locations: Location[];
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateCardInstance, EMPTY_STATE);

  const card = instance.cards;
  const finishes = (card?.available_finishes?.length
    ? card.available_finishes
    : ["nonfoil"]) as Finish[];
  // A previously recorded finish that this printing no longer lists must stay
  // selectable, or saving an unrelated edit would silently change it.
  const finishOptions = Array.from(new Set([...finishes, instance.finish])) as Finish[];

  return (
    <li className="p-4">
      <div className="flex items-start gap-3">
        {card?.image_uri_small ? (
          <Image
            src={card.image_uri_small}
            alt=""
            width={48}
            height={67}
            className="rounded-sm"
            unoptimized
          />
        ) : (
          <span className="h-[67px] w-[48px] rounded-sm bg-[--color-surface-muted]" />
        )}

        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {card?.name ?? "Unknown card"}
            {instance.quantity > 1 ? (
              <span className="ml-2 text-sm text-[--color-ink-muted]">
                ×{instance.quantity}
              </span>
            ) : null}
          </p>
          <p className="text-sm text-[--color-ink-muted]">
            {card ? `${card.set_name ?? card.set_code.toUpperCase()} · #${card.collector_number}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-[--color-ink-muted]">
            {CONDITION_LABELS[instance.condition]} ·{" "}
            {FINISH_LABELS[instance.finish] ?? instance.finish} ·{" "}
            {languageLabel(instance.language)}
          </p>
          {instance.notes ? (
            <p className="mt-1 text-xs italic text-[--color-ink-muted]">{instance.notes}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {/* Move: submits on change, no save button. */}
          <form action={moveCardInstance}>
            <input type="hidden" name="instance_id" value={instance.id} />
            <Select
              name="location_id"
              defaultValue={instance.location_id ?? ""}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              aria-label={`Location for ${card?.name ?? "card"}`}
              className="w-44 text-xs"
            >
              <option value="">Unsorted</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </form>

          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => setEditing((v) => !v)} className="text-xs">
              {editing ? "Cancel" : "Edit"}
            </Button>
            <form action={deleteCardInstance}>
              <input type="hidden" name="instance_id" value={instance.id} />
              <Button variant="danger" type="submit" className="text-xs">
                Delete
              </Button>
            </form>
          </div>
        </div>
      </div>

      {editing ? (
        <form action={action} className="mt-4 space-y-3 rounded-md bg-[--color-surface-muted] p-3">
          <input type="hidden" name="instance_id" value={instance.id} />
          <input type="hidden" name="location_id" value={instance.location_id ?? ""} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Condition">
              <Select name="condition" defaultValue={instance.condition}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Finish">
              <Select name="finish" defaultValue={instance.finish}>
                {finishOptions.map((f) => (
                  <option key={f} value={f}>
                    {FINISH_LABELS[f] ?? f}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Language">
              <Select name="language" defaultValue={instance.language}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Quantity">
              <Input
                name="quantity"
                type="number"
                min={1}
                max={10000}
                defaultValue={instance.quantity}
              />
            </Field>

            <Field label="Notes">
              <Input name="notes" maxLength={500} defaultValue={instance.notes ?? ""} />
            </Field>
          </div>

          <Banner kind="error">{state.error}</Banner>

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      ) : null}
    </li>
  );
}

export function CollectionList({
  instances,
  locations,
}: {
  instances: CardInstanceWithCard[];
  locations: Location[];
}) {
  return (
    <ul className="divide-y divide-[--color-border] rounded-lg border border-[--color-border]">
      {instances.map((instance) => (
        <InstanceRow key={instance.id} instance={instance} locations={locations} />
      ))}
    </ul>
  );
}
