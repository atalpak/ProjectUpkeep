"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { LOCATION_TYPES, type Location, type LocationType } from "@/lib/types";
import type { LocationActionState } from "@/app/(app)/locations/action-state";

function fail(message: string): LocationActionState {
  return { error: message, notice: null };
}

/**
 * Translates the trigger and constraint messages from migration 0004 into
 * something a person filing cards can act on.
 */
function friendly(message: string): string {
  if (message.includes("one level of nesting")) {
    return "Locations can only be nested one level deep — pick a top-level container.";
  }
  if (message.includes("already has locations inside it")) {
    return "That location has things inside it, so it can't be nested in another.";
  }
  if (message.includes("another user's location")) {
    return "That location belongs to a different account.";
  }
  if (message.includes("duplicate key") || message.includes("locations_unique_name_per_parent")) {
    return "You already have a location with that name in the same place.";
  }
  if (message.includes("locations_name_length")) {
    return "Give the location a name of 1–80 characters.";
  }
  return message;
}

function optionalId(value: FormDataEntryValue | null): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" ? null : s;
}

export async function createLocation(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return fail("Give the location a name.");

  const type = String(formData.get("type") ?? "other") as LocationType;
  if (!LOCATION_TYPES.includes(type)) return fail("Unknown location type.");

  const supabase = await createClient();
  const { error } = await supabase.from("locations").insert({
    user_id: user.id,
    name,
    type,
    parent_location_id: optionalId(formData.get("parent_location_id")),
  });

  if (error) return fail(friendly(error.message));

  revalidatePath("/locations");
  revalidatePath("/collection");
  return { error: null, notice: `Created "${name}".` };
}

/**
 * Create a location from inside another form, and hand the row back.
 *
 * Filing a card is where you discover you need a container, and going to the
 * locations page to make one means abandoning whatever you were half-way
 * through typing. This exists so a destination dropdown can offer "New
 * location…" and select the result on the spot.
 *
 * Returns the row rather than a notice: the caller has a <select> to point at
 * the new id, and waiting for the page to revalidate before it can do that
 * would leave the field blank in the meantime.
 *
 * Not `useActionState`-shaped on purpose — it is awaited directly from an event
 * handler, so the result can be applied without an effect.
 */
export async function createLocationInline(
  formData: FormData,
): Promise<{ error: string | null; location: Location | null }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in.", location: null };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the location a name.", location: null };

  const type = String(formData.get("type") ?? "other") as LocationType;
  if (!LOCATION_TYPES.includes(type)) {
    return { error: "Unknown location type.", location: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .insert({
      user_id: user.id,
      name,
      type,
      parent_location_id: optionalId(formData.get("parent_location_id")),
    })
    .select("*")
    .single();

  if (error) return { error: friendly(error.message), location: null };

  revalidatePath("/locations");
  revalidatePath("/collection");
  revalidatePath("/decks");
  return { error: null, location: data as Location };
}

export async function renameLocation(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const id = String(formData.get("location_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!id) return fail("Missing location.");
  if (!name) return fail("Give the location a name.");

  const type = String(formData.get("type") ?? "other") as LocationType;
  if (!LOCATION_TYPES.includes(type)) return fail("Unknown location type.");

  const supabase = await createClient();
  // RLS scopes this to the user's own locations.
  const { error } = await supabase
    .from("locations")
    .update({ name, type })
    .eq("id", id);

  if (error) return fail(friendly(error.message));

  revalidatePath("/locations");
  revalidatePath("/collection");
  return { error: null, notice: "Saved." };
}

/**
 * Deleting a location is non-destructive by design: the FKs in migration 0004
 * and 0005 unsort its cards (location_id -> null) and promote any child
 * locations to the top level. Nobody loses cards by tidying up their containers.
 */
export async function deleteLocation(formData: FormData): Promise<void> {
  const id = String(formData.get("location_id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("locations").delete().eq("id", id);

  revalidatePath("/locations");
  revalidatePath("/collection");
}
