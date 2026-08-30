"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { LOCATION_TYPES, type LocationType } from "@/lib/types";

export type LocationActionState = { error: string | null; notice: string | null };

export const EMPTY_LOCATION_STATE: LocationActionState = { error: null, notice: null };

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
