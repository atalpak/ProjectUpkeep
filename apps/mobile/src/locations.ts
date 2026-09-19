import { backend } from './backend';

// Locations: the containers (binders, boxes, anything else) a user sorts cards
// into. Decks are locations too but live on the Decks tab, so they are left
// out here. Every read scopes on the owner explicitly -- RLS alone would mix a
// friend's tradable containers in (CLAUDE.md constraint 3).

export const LOCATION_TYPES = ['binder', 'box', 'other'] as const;
export type LocationKind = (typeof LOCATION_TYPES)[number];
export const LOCATION_TYPE_LABELS: Record<string, string> = { binder: 'Binder', box: 'Box', other: 'Other' };

export const LOCATION_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type LocationColor = (typeof LOCATION_COLORS)[number];
// Fixed hex, same values as the web app: a colour tag reads the same in either theme.
export const LOCATION_COLOR_HEX: Record<LocationColor, string> = {
  red: '#c0392b', orange: '#d97a2c', yellow: '#c9a227', green: '#4c9a5c', teal: '#2f9e94', blue: '#3f7fc4', purple: '#8f5fc9', pink: '#c9518f',
};

export type LocationRow = {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  color: LocationColor | null;
  tradable: boolean;
  /** Total cards (sum of quantity) sitting directly in this location. */
  cardCount: number;
};

const isColor = (c: unknown): c is LocationColor => (LOCATION_COLORS as readonly string[]).includes(c as string);

/** Turns the database's messages into something a person filing cards can act on (mirrors the web app). */
function friendly(message: string): string {
  if (message.includes('one level of nesting')) return 'Locations can only be nested one level deep. Pick a top-level location.';
  if (message.includes('already has locations inside it')) return 'That location has things inside it, so it can’t be nested in another.';
  if (message.includes('duplicate key') || message.includes('locations_unique_name_per_parent')) return 'You already have a location with that name in the same place.';
  if (message.includes('locations_name_length')) return 'Give the location a name of 1–80 characters.';
  return message;
}

/** Every non-deck location, plus how many cards sit in each and how many are unsorted. */
export async function fetchLocations(userId: string): Promise<{ locations: LocationRow[]; unsorted: number }> {
  if (!backend) return { locations: [], unsorted: 0 };
  const { data, error } = await backend
    .from('locations')
    .select('id,name,type,parent_location_id,color,is_tradable')
    .eq('user_id', userId)
    .neq('type', 'deck')
    .order('name')
    .limit(1000);
  if (error) throw new Error(error.message);

  // Counts: sum quantity per location across the collection view, paged (PostgREST caps a response at 1000).
  const counts = new Map<string | null, number>();
  for (let from = 0; from < 20_000; from += 1000) {
    const { data: page, error: pageError } = await backend
      .from('collection_entries')
      .select('location_id,quantity')
      .eq('owner_user_id', userId)
      .order('id')
      .range(from, from + 999);
    if (pageError) throw new Error(pageError.message);
    for (const r of page ?? []) {
      const key = (r.location_id as string | null) ?? null;
      counts.set(key, (counts.get(key) ?? 0) + (r.quantity as number));
    }
    if (!page || page.length < 1000) break;
  }

  return {
    locations: (data ?? []).map(l => ({
      id: l.id as string, name: l.name as string, type: l.type as string, parentId: (l.parent_location_id as string | null) ?? null,
      color: isColor(l.color) ? l.color : null, tradable: !!l.is_tradable, cardCount: counts.get(l.id as string) ?? 0,
    })),
    unsorted: counts.get(null) ?? 0,
  };
}

export async function createLocation(userId: string, input: { name: string; type: LocationKind; parentId: string | null; color: LocationColor | null }): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const name = input.name.trim();
  if (!name) throw new Error('Give the location a name.');
  const { error } = await backend.from('locations').insert({ user_id: userId, name, type: input.type, parent_location_id: input.parentId, color: input.color });
  if (error) throw new Error(friendly(error.message));
}

export async function updateLocation(userId: string, id: string, patch: { name: string; type: LocationKind; color: LocationColor | null }): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const name = patch.name.trim();
  if (!name) throw new Error('Give the location a name.');
  const { error } = await backend.from('locations').update({ name, type: patch.type, color: patch.color }).eq('id', id).eq('user_id', userId);
  if (error) throw new Error(friendly(error.message));
}

/** Opens or closes a container for trade -- the one switch that makes cards visible to friends. */
export async function setLocationTradable(userId: string, id: string, tradable: boolean): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const { error } = await backend.from('locations').update({ is_tradable: tradable }).eq('id', id).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/** Deleting is non-destructive by design: the cards become unsorted and any child locations move to the top level. */
export async function deleteLocation(userId: string, id: string): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const { error } = await backend.from('locations').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export type LocationCard = {
  id: string; cardId: string; name: string; setCode: string; collectorNumber: string; quantity: number;
  condition: string; finish: string; language: string; imageSmall: string | null;
};

/** The cards in one location, or the unsorted ones when `locationId` is null. */
export async function fetchLocationCards(userId: string, locationId: string | null): Promise<LocationCard[]> {
  if (!backend) return [];
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    let query = backend
      .from('collection_entries')
      .select('id,card_id,card_name,card_set_code,card_collector_number,quantity,condition,finish,language,card_image_uri_small')
      .eq('owner_user_id', userId)
      // Name first for display; id breaks ties so paging never skips or repeats a row.
      .order('card_name')
      .order('id')
      .range(from, from + 999);
    query = locationId ? query.eq('location_id', locationId) : query.is('location_id', null);
    const { data: page, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...((page ?? []) as Record<string, unknown>[]));
    if (!page || page.length < 1000) break;
  }
  const data = rows;
  return (data ?? []).map(r => ({
    id: r.id as string, cardId: r.card_id as string, name: r.card_name as string, setCode: r.card_set_code as string,
    collectorNumber: r.card_collector_number as string, quantity: r.quantity as number, condition: r.condition as string,
    finish: r.finish as string, language: r.language as string, imageSmall: (r.card_image_uri_small as string | null) ?? null,
  }));
}
