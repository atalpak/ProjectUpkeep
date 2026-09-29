"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { applyStackRekey, planBatchRekey, type BatchRekeyRow } from "@/lib/collection/rekey";

/** Move an owned stack between non-deck locations from the explorer. */
export async function moveWorkspaceCopy(instanceId: string, locationId: string | null): Promise<{ error: string | null }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };
  const supabase = await createClient();

  if (locationId) {
    const { data: destination, error } = await supabase.from("locations")
      .select("id").eq("id", locationId).eq("user_id", user.id).neq("type", "deck").maybeSingle();
    if (error || !destination) return { error: "Choose one of your locations." };
  }

  const { data: source, error: sourceError } = await supabase.from("card_instances")
    .select("id, card_id, condition, finish, language, location_id, notes, quantity")
    .eq("id", instanceId).eq("owner_user_id", user.id).maybeSingle();
  if (sourceError || !source) return { error: "That copy is no longer in your collection." };
  if (source.location_id === locationId) return { error: null };
  if (source.location_id) {
    const { data: currentPlace, error: placeError } = await supabase.from("locations")
      .select("type").eq("id", source.location_id).eq("user_id", user.id).maybeSingle();
    if (placeError || !currentPlace) return { error: "Could not verify where that copy is." };
    if (currentPlace.type === "deck") return { error: "Use the deck's Unsleeve action to move this copy out." };
  }

  const { data: existing, error: readError } = await supabase.from("card_instances")
    .select("id, card_id, condition, finish, language, location_id, notes, quantity")
    .eq("owner_user_id", user.id).eq("card_id", source.card_id);
  if (readError) return { error: readError.message };

  const steps = planBatchRekey([source as BatchRekeyRow], (row) => ({ ...row, location_id: locationId }), (existing ?? []) as BatchRekeyRow[]);
  const { error } = await applyStackRekey(supabase, steps);
  if (error) return { error };
  revalidatePath("/collection");
  revalidatePath("/locations");
  return { error: null };
}
