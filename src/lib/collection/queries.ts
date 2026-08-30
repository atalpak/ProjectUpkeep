import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CardInstanceWithCard, Location, LocationNode } from "@/lib/types";

/**
 * Read helpers for the signed-in user's collection.
 *
 * Every query here runs as the user through RLS, so none of them filter by
 * user id themselves — the database does it. Adding a redundant `.eq('owner_
 * user_id', ...)` would only create a second place to get it wrong.
 */

/** Special value for the location filter, since null already means "unsorted". */
export const UNSORTED = "unsorted";

export type CollectionFilter = {
  /** A location id, UNSORTED, or undefined for everything. */
  location?: string;
  /** Case-insensitive substring match on card name. */
  q?: string;
};

export async function getCollection(
  filter: CollectionFilter = {},
): Promise<CardInstanceWithCard[]> {
  const supabase = await createClient();

  let query = supabase
    .from("card_instances")
    .select(
      `id, owner_user_id, card_id, location_id, condition, finish, language,
       quantity, notes, acquired_at, created_at, updated_at,
       cards ( scryfall_id, oracle_id, name, set_code, set_name, collector_number,
               rarity, type_line, released_at, image_uri, image_uri_small,
               scryfall_uri, available_finishes, lang, digital, last_synced_at ),
       locations ( id, name, type )`,
    )
    .order("created_at", { ascending: false });

  if (filter.location === UNSORTED) {
    query = query.is("location_id", null);
  } else if (filter.location) {
    query = query.eq("location_id", filter.location);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load collection: ${error.message}`);

  const rows = (data ?? []) as unknown as CardInstanceWithCard[];

  // Name filtering happens here rather than in the query: PostgREST cannot
  // filter on an embedded resource without turning the join into an inner join,
  // which would silently drop instances whose printing is missing. Collections
  // are small enough (thousands, not millions) that this is fine.
  if (filter.q) {
    const needle = filter.q.toLowerCase();
    return rows.filter((r) => r.cards?.name.toLowerCase().includes(needle));
  }

  return rows;
}

export async function getLocations(): Promise<Location[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw new Error(`Could not load locations: ${error.message}`);
  return (data ?? []) as Location[];
}

/**
 * Locations arranged as parents with their children, plus how many instances
 * sit directly in each. Counting here rather than per-row in the UI keeps the
 * locations page to two queries regardless of how many locations exist.
 */
export async function getLocationTree(): Promise<{
  tree: LocationNode[];
  unsortedCount: number;
}> {
  const supabase = await createClient();

  const [{ data: locations, error: locError }, { data: instances, error: instError }] =
    await Promise.all([
      supabase.from("locations").select("*").order("name", { ascending: true }),
      supabase.from("card_instances").select("location_id, quantity"),
    ]);

  if (locError) throw new Error(`Could not load locations: ${locError.message}`);
  if (instError) throw new Error(`Could not load collection: ${instError.message}`);

  // Count physical cards, not rows: a stack of 12 should read as 12.
  const counts = new Map<string, number>();
  let unsortedCount = 0;
  for (const row of instances ?? []) {
    const { location_id, quantity } = row as { location_id: string | null; quantity: number };
    if (location_id === null) {
      unsortedCount += quantity;
    } else {
      counts.set(location_id, (counts.get(location_id) ?? 0) + quantity);
    }
  }

  const all = (locations ?? []) as Location[];
  const byParent = new Map<string, Location[]>();
  for (const loc of all) {
    if (loc.parent_location_id) {
      const siblings = byParent.get(loc.parent_location_id) ?? [];
      siblings.push(loc);
      byParent.set(loc.parent_location_id, siblings);
    }
  }

  const tree = all
    .filter((l) => l.parent_location_id === null)
    .map((l) => ({
      ...l,
      children: byParent.get(l.id) ?? [],
      instance_count: counts.get(l.id) ?? 0,
    }));

  return { tree, unsortedCount };
}
